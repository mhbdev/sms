import { describe, expect, it } from "vitest";

import type { SmsHttpFetcher } from "../src/contracts/http";
import { KavenegarSmsProvider } from "../src/providers/kavenegar/kavenegar-sms-provider";

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("KavenegarSmsProvider", () => {
	it("preserves raw and lookup sending behavior", async () => {
		const requests: Array<{ url: string; body: string }> = [];
		const fetcher: SmsHttpFetcher = async (input, init) => {
			requests.push({ url: String(input), body: String(init?.body ?? "") });
			return response({
				return: { status: 200, message: "confirmed" },
				entries: { messageid: 42, status: 5, receptor: "09121234567" },
			});
		};
		const provider = new KavenegarSmsProvider({
			apiKey: "secret-key",
			sender: "90005738",
			fetcher,
		});

		await provider.sendTemplate({
			recipient: "+989121234567",
			template: "otp",
			parameters: ["123456"],
		});
		await provider.sendMessage({ recipient: "+989121234567", message: "raw" });

		expect(requests).toHaveLength(2);
		expect(requests[0]?.url).toContain("/verify/lookup.json");
		expect(requests[0]?.body).toContain("receptor=09121234567");
		expect(requests[0]?.body).toContain("token=123456");
		expect(requests[1]?.url).toContain("/sms/send.json");
		expect(requests[1]?.body).toContain("sender=90005738");
	});

	it("supports default and per-message sender numbers", async () => {
		const requests: Array<{ url: string; body: string }> = [];
		const fetcher: SmsHttpFetcher = async (input, init) => {
			const url = String(input);
			requests.push({ url, body: String(init?.body ?? "") });
			const entries = url.includes("sendarray")
				? [
						{ messageid: 3, status: 1, sender: "10004346" },
						{ messageid: 4, status: 1, sender: "10000000" },
					]
				: [{ messageid: 1, status: 1, sender: "10004346" }];
			return response({ return: { status: 200 }, entries });
		};
		const provider = new KavenegarSmsProvider({
			apiKey: "secret-key",
			sender: "10004346",
			fetcher,
		});

		await provider.sendMessage({ recipient: "0912", message: "raw" });
		await provider.sendBulk({
			recipients: ["0912", "0936"],
			message: "bulk",
			sender: "10000000",
		});
		await provider.sendArray([
			{ recipient: "0912", message: "default sender" },
			{ recipient: "0936", message: "override sender", sender: "10000000" },
		]);

		const raw = new URLSearchParams(requests[0]?.body);
		const bulk = new URLSearchParams(requests[1]?.body);
		const sendArray = new URLSearchParams(requests[2]?.body);
		expect(raw.get("sender")).toBe("10004346");
		expect(bulk.get("sender")).toBe("10000000");
		expect(JSON.parse(sendArray.get("sender") ?? "[]")).toEqual(["10004346", "10000000"]);
	});

	it("requires a sender for every send-array item", async () => {
		const fetcher = async () => response({ return: { status: 200 }, entries: [] });
		const provider = new KavenegarSmsProvider({ apiKey: "secret-key", fetcher });

		await expect(
			provider.sendArray([{ recipient: "0912", message: "test" }]),
		).rejects.toThrow("Sender is required");
	});

	it("uses Kavenegar's outbound count endpoint", async () => {
		let requestedUrl = "";
		const fetcher = async (input: string | URL | Request) => {
			requestedUrl = String(input);
			return response({
				return: { status: 200 },
				entries: [{ startdate: 1, enddate: 2, sumcount: 3 }],
			});
		};
		const provider = new KavenegarSmsProvider({ apiKey: "secret-key", fetcher });

		await provider.countSentMessages({ startDate: 1 });
		expect(requestedUrl).toContain("/sms/countoutbox.json");
	});

	it("parses status, cancellation, and received-message operations", async () => {
		const fetcher: SmsHttpFetcher = async (input) => {
			const url = String(input);
			if (url.includes("status")) {
				return response({
					return: { status: 200 },
					entries: { messageid: 7, status: 10, statustext: "delivered" },
				});
			}
			if (url.includes("cancel")) {
				return response({
					return: { status: 200 },
					entries: { messageid: 7, status: 13, statustext: "cancelled" },
				});
			}
			return response({
				return: { status: 200 },
				entries: {
					messageid: 8,
					message: "reply",
					sender: "0912",
					receptor: "3000",
					date: 123,
				},
			});
		};
		const provider = new KavenegarSmsProvider({ apiKey: "secret-key", fetcher });

		expect(
			(await provider.getDeliveryStatus({ messageIds: [7] }))[0]?.providerStatus,
		).toBe("10");
		expect((await provider.cancelScheduled({ ids: [7] }))[0]?.providerStatus).toBe("13");
		expect(
			(await provider.getReceivedMessages({ lineNumber: "3000", isRead: false })).items[0]
				?.message,
		).toBe("reply");
	});

	it("rejects malformed successful payloads", async () => {
		const fetcher: SmsHttpFetcher = async () =>
			response({ return: { status: 200 }, entries: { messageid: "not-a-number" } });
		const provider = new KavenegarSmsProvider({ apiKey: "secret-key", fetcher });

		await expect(
			provider.sendMessage({ recipient: "0912", message: "test" }),
		).rejects.toThrow("Kavenegar response omitted");
	});

	it("rejects malformed response entries with Zod validation", async () => {
		const fetcher: SmsHttpFetcher = async () =>
			response({ return: { status: 200 }, entries: [{ messageid: { leaked: true } }] });
		const provider = new KavenegarSmsProvider({
			apiKey: "super-secret-api-key",
			fetcher,
		});

		let error: unknown;
		try {
			await provider.sendMessage({ recipient: "0912", message: "private message" });
		} catch (value) {
			error = value;
		}
		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		expect(message).toContain("messageid");
		expect(message).not.toContain("super-secret-api-key");
		expect(message).not.toContain("private message");
	});

	it("rejects unsupported send-array fields instead of silently dropping them", async () => {
		const fetcher: SmsHttpFetcher = async () => response({});
		const provider = new KavenegarSmsProvider({ apiKey: "secret-key", fetcher });

		await expect(
			provider.sendArray([
				{
					recipient: "0912",
					message: "test",
					sendAt: 1,
				} as never,
			]),
		).rejects.toThrow('Unrecognized key: "sendAt"');
	});
});
