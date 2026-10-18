import { describe, expect, it, vi } from "vitest";

import type { SmsMessage } from "../src/contracts/sms.js";
import { KavenegarError } from "../src/errors/kavenegar-error.js";
import { SmsValidationError } from "../src/errors/sms-error.js";
import { InMemoryCircuitBreaker } from "../src/pool/health.js";
import { SmsProviderPool, SmsProviderPoolError } from "../src/pool/sms-provider-pool.js";
import { WeightedRoundRobinStrategy } from "../src/pool/strategies.js";

function accepted(name: string) {
	return { provider: name, messageId: "1", status: "accepted" as const };
}

function rejected() {
	return new KavenegarError("rate limited", {
		deliveryOutcome: "rejected",
		retryable: true,
		retryAfterMs: 0,
	});
}

const message: SmsMessage = { recipient: "09120000000", message: "hello" };

describe("SmsProviderPool", () => {
	it("uses priority order and fails over after a definite retryable rejection", async () => {
		const first = vi.fn().mockRejectedValue(rejected());
		const second = vi.fn().mockResolvedValue(accepted("second"));
		const pool = new SmsProviderPool({
			providers: [
				{ name: "second", priority: 2, sendMessage: second },
				{ name: "first", priority: 1, sendMessage: first },
			],
			sleep: async () => undefined,
		});

		await expect(pool.sendMessage(message)).resolves.toMatchObject({
			provider: "second",
		});
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("stops on unknown outcomes and exposes only sanitized attempt metadata", async () => {
		const first = vi.fn().mockRejectedValue(new Error("private message and api-key"));
		const second = vi.fn().mockResolvedValue(accepted("second"));
		const pool = new SmsProviderPool({
			providers: [
				{ name: "first", priority: 1, sendMessage: first },
				{ name: "second", priority: 2, sendMessage: second },
			],
		});

		const error = await pool.sendMessage(message).catch((value: unknown) => value);
		expect(error).toBeInstanceOf(SmsProviderPoolError);
		expect(error).toMatchObject({
			outcome: "unknown",
			attempts: [{ provider: "first", outcome: "unknown" }],
		});
		expect((error as Error).message).not.toContain("private message");
		expect(second).not.toHaveBeenCalled();
	});

	it("supports per-provider retries after definite rejection", async () => {
		const send = vi
			.fn()
			.mockRejectedValueOnce(rejected())
			.mockResolvedValue(accepted("one"));
		const pool = new SmsProviderPool({
			providers: [{ name: "one", sendMessage: send }],
			maxAttemptsPerProvider: 2,
			sleep: async () => undefined,
		});

		await expect(pool.sendMessage(message)).resolves.toMatchObject({ provider: "one" });
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("uses weighted round robin distribution", async () => {
		const calls: string[] = [];
		const send = (name: string) => async () => {
			calls.push(name);
			return accepted(name);
		};
		const pool = new SmsProviderPool({
			strategy: new WeightedRoundRobinStrategy(),
			providers: [
				{ name: "heavy", weight: 3, sendMessage: send("heavy") },
				{ name: "light", weight: 1, sendMessage: send("light") },
			],
		});
		for (let index = 0; index < 4; index += 1) await pool.sendMessage(message);
		expect(calls.filter((name) => name === "heavy")).toHaveLength(3);
		expect(calls.filter((name) => name === "light")).toHaveLength(1);
	});

	it("honors a custom routing strategy", async () => {
		const calls: string[] = [];
		const pool = new SmsProviderPool({
			strategy: { order: () => ["second", "first"] },
			providers: [
				{
					name: "first",
					sendMessage: async () => {
						calls.push("first");
						return accepted("first");
					},
				},
				{
					name: "second",
					sendMessage: async () => {
						calls.push("second");
						return accepted("second");
					},
				},
			],
		});
		await pool.sendMessage(message);
		expect(calls).toEqual(["second"]);
	});

	it("skips providers without the requested capability", async () => {
		const pool = new SmsProviderPool({
			providers: [
				{ name: "only-template", sendTemplate: async () => accepted("only-template") },
			],
		});
		await expect(pool.sendMessage(message)).rejects.toMatchObject({
			outcome: "unavailable",
		});
	});

	it("opens, cools down, and probes a circuit with only one half-open caller", async () => {
		let now = 100;
		const health = new InMemoryCircuitBreaker({
			failureThreshold: 1,
			cooldownMs: 50,
			now: () => now,
		});
		health.recordFailure("p");
		expect(health.getState("p")).toBe("open");
		expect(health.acquire("p")).toBe(false);
		now += 50;
		expect(health.getState("p")).toBe("half-open");
		expect(health.acquire("p")).toBe(true);
		expect(health.acquire("p")).toBe(false);
		health.recordSuccess("p");
		expect(health.getState("p")).toBe("closed");
	});

	it("skips an open provider and closes its circuit after a successful half-open probe", async () => {
		let now = 100;
		let calls = 0;
		const pool = new SmsProviderPool({
			providers: [
				{
					name: "p",
					sendMessage: async () => {
						calls += 1;
						if (calls === 1) throw new Error("upstream timed out");
						return accepted("p");
					},
				},
			],
			circuitBreaker: { failureThreshold: 1, cooldownMs: 25, now: () => now },
		});
		await expect(pool.sendMessage(message)).rejects.toMatchObject({ outcome: "unknown" });
		await expect(pool.sendMessage(message)).rejects.toMatchObject({
			outcome: "unavailable",
		});
		now += 25;
		await expect(pool.sendMessage(message)).resolves.toMatchObject({ provider: "p" });
		expect(calls).toBe(2);
	});

	it("does not fail over on validation errors or caller aborts", async () => {
		const validationFallback = vi.fn().mockResolvedValue(accepted("second"));
		const validationPool = new SmsProviderPool({
			providers: [
				{
					name: "first",
					sendMessage: async () => {
						throw new SmsValidationError("invalid input");
					},
				},
				{ name: "second", sendMessage: validationFallback },
			],
		});
		await expect(validationPool.sendMessage(message)).rejects.toBeInstanceOf(
			SmsValidationError,
		);
		expect(validationFallback).not.toHaveBeenCalled();

		const controller = new AbortController();
		const abortFallback = vi.fn().mockResolvedValue(accepted("second"));
		const abortPool = new SmsProviderPool({
			providers: [
				{
					name: "first",
					sendMessage: async () => {
						controller.abort();
						throw new Error("aborted");
					},
				},
				{ name: "second", sendMessage: abortFallback },
			],
		});
		await expect(
			abortPool.sendMessage({ ...message, signal: controller.signal }),
		).rejects.toMatchObject({ code: "SMS_POOL_ABORTED" });
		expect(abortFallback).not.toHaveBeenCalled();
	});

	it("emits lifecycle events without allowing observers to break sends", async () => {
		const onEvent = vi.fn(() => {
			throw new Error("observer failed");
		});
		const pool = new SmsProviderPool({
			providers: [{ name: "p", sendMessage: async () => accepted("p") }],
			onEvent,
		});
		await expect(pool.sendMessage(message)).resolves.toMatchObject({ provider: "p" });
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "provider-selected", provider: "p" }),
		);
	});
});
