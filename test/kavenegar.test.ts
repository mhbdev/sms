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
});
