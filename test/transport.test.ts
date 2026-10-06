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
});
