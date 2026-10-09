import { describe, expect, it, vi } from "vitest";

import { SmsHttpTransport } from "../src/transport/http";

describe("SmsHttpTransport", () => {
	it("does not retry unless a policy is configured", async () => {
		const fetcher = vi.fn(async () => new Response("no", { status: 503 }));
		const transport = new SmsHttpTransport({ fetcher, timeoutMs: 100 });

		const response = await transport.request("https://example.test", { method: "GET" });

		expect(response.status).toBe(503);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("retries transient responses with the configured policy", async () => {
		let attempts = 0;
		const fetcher = vi.fn(async () => {
			attempts += 1;
			return attempts === 1
				? new Response("retry", { status: 503 })
				: new Response("ok", { status: 200 });
		});
		const transport = new SmsHttpTransport({
			fetcher,
			timeoutMs: 100,
			retry: { maxAttempts: 2, initialDelayMs: 0, sleep: async () => undefined },
		});

		const response = await transport.request("https://example.test", { method: "GET" });

		expect(response.status).toBe(200);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("does not retry a caller abort", async () => {
		const controller = new AbortController();
		const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			controller.abort(new Error("caller cancelled"));
			throw init?.signal?.reason ?? new Error("request was not aborted");
		});
		const sleep = vi.fn(async () => undefined);
		const transport = new SmsHttpTransport({
			fetcher,
			timeoutMs: 100,
			retry: { maxAttempts: 3, sleep },
		});

		await expect(
			transport.request(
				"https://example.test",
				{ method: "GET" },
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: "SMS_TRANSPORT_ERROR", retryable: false });
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("caps Retry-After delays at the configured maximum", async () => {
		const fetcher = vi.fn(
			async () =>
				new Response("retry", { status: 429, headers: { "Retry-After": "120" } }),
		);
		const sleep = vi.fn(async () => undefined);
		const transport = new SmsHttpTransport({
			fetcher,
			timeoutMs: 100,
			retry: { maxAttempts: 2, maxDelayMs: 250, sleep },
		});

		await transport.request("https://example.test", { method: "GET" });
		expect(sleep).toHaveBeenCalledWith(250, undefined);
	});
});
