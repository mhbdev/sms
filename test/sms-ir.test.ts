import { describe, expect, it } from "vitest";

import type { SmsHttpFetcher } from "../src/contracts/http";
import { SmsIrProvider } from "../src/providers/sms-ir/sms-ir-provider";

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("SmsIrProvider", () => {
	it("sends bulk and verify messages using documented JSON payloads", async () => {
		const requests: Array<{ url: string; body: string; headers: Headers }> = [];
		const fetcher: SmsHttpFetcher = async (input, init) => {
			requests.push({
				url: String(input),
				body: String(init?.body ?? ""),
				headers: new Headers(init?.headers),
			});
			return requests.at(-1)?.url.includes("verify")
				? response({ status: 1, message: "ok", data: { messageId: 99, cost: 1 } })
				: response({
						status: 1,
						message: "ok",
						data: { packId: "pack-1", messageIds: [99], cost: 1 },
					});
		};
		const provider = new SmsIrProvider({
			apiKey: "secret-key",
			lineNumber: "3000",
			fetcher,
		});

		const bulk = await provider.sendBulk({ recipients: ["0912"], message: "hello" });
		const verify = await provider.sendTemplate({
			recipient: "0912",
			templateId: 123,
			parameters: [{ name: "Code", value: "1234" }],
		});

		expect(bulk.batchId).toBe("pack-1");
		expect(verify.messageId).toBe("99");
		expect(requests[0]?.headers.get("x-api-key")).toBe("secret-key");
		expect(requests[0]?.body).toContain('"lineNumber":"3000"');
		expect(requests[1]?.body).toContain('"templateId":123');
	});

	it("supports reports and scheduled cancellation", async () => {
		const fetcher: SmsHttpFetcher = async (input) => {
			const url = String(input);
			if (url.includes("scheduled"))
				return response({
					status: 1,
					message: "cancelled",
					data: { returnedCreditCount: 2, smsCount: 1 },
				});
			if (url.includes("pack/"))
				return response({
					status: 1,
					data: [{ messageId: 1, mobile: 912, deliveryState: 1 }],
				});
			if (url.includes("send/1"))
				return response({
					status: 1,
					data: { messageId: 1, mobile: 912, deliveryState: 1 },
				});
			return response({
				status: 1,
				data: [{ packId: "pack-1", recipientCount: 1, creationDateTime: 123 }],
			});
		};
		const provider = new SmsIrProvider({
			apiKey: "secret-key",
			lineNumber: "3000",
			fetcher,
		});

		expect((await provider.getMessageStatus(1)).messageId).toBe("1");
		expect((await provider.listPacks())[0]?.packId).toBe("pack-1");
		expect((await provider.getPack("pack-1"))[0]?.messageId).toBe("1");
		expect((await provider.cancelScheduled("pack-1")).returnedCredit).toBe(2);
	});

	it("rejects provider failures and invalid template IDs", async () => {
		const fetcher: SmsHttpFetcher = async () =>
			response({ status: 401, message: "unauthorized" }, 401);
		const provider = new SmsIrProvider({
			apiKey: "secret-key",
			lineNumber: "3000",
			fetcher,
		});

		await expect(
			provider.sendMessage({ recipient: "0912", message: "test" }),
		).rejects.toThrow("unauthorized");
		await expect(
			provider.sendTemplate({ recipient: "0912", templateId: 0, parameters: [] }),
		).rejects.toThrow("positive integer");
	});

	it("rejects malformed successful payloads without exposing secrets", async () => {
		const fetcher: SmsHttpFetcher = async () =>
			response({ status: 1, data: { messageIds: [1] } });
		const provider = new SmsIrProvider({
			apiKey: "super-secret-api-key",
			lineNumber: "3000",
			fetcher,
		});

		let error: unknown;
		try {
			await provider.sendBulk({ recipients: ["0912"], message: "private message" });
		} catch (value) {
			error = value;
		}
		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		expect(message).toContain("bulk data");
		expect(message).not.toContain("super-secret-api-key");
		expect(message).not.toContain("private message");
	});
});
