import type {
	SmsIrBulkMessage,
	SmsIrBulkSendResult,
	SmsIrCancellationResult,
	SmsIrLikeToLikeMessage,
	SmsIrMessageStatus,
	SmsIrPackMessage,
	SmsIrPackSummary,
	SmsIrParameter,
	SmsIrProviderOptions,
	SmsIrSendResult,
	SmsIrTemplateMessage,
} from "../../contracts/sms-ir";
import { SmsIrError } from "../../errors/sms-ir-error";
import {
	SmsHttpTransport,
	toUnixSeconds,
	validateRecipients,
	validateRequiredString,
} from "../../transport/http";
import {
	parseSmsIrBulkResult,
	parseSmsIrMessageStatus,
	parseSmsIrPackMessages,
	parseSmsIrPackSummaries,
	parseSmsIrPayload,
	parseSmsIrSendResult,
} from "./sms-ir-api";

const DEFAULT_BASE_URL = "https://api.sms.ir/v1";

export class SmsIrProvider {
	readonly name = "sms.ir";
	private readonly apiKey: string;
	private readonly lineNumber: string;
	private readonly baseUrl: string;
	private readonly transport: SmsHttpTransport;

	constructor(options: SmsIrProviderOptions) {
		if (!options.apiKey.trim()) throw new SmsIrError("SMS.ir API key is required");
		this.apiKey = options.apiKey;
		this.lineNumber = String(options.lineNumber);
		validateRequiredString(this.lineNumber, "SMS.ir line number");
		this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
		this.transport = new SmsHttpTransport({
			fetcher: options.fetcher ?? fetch,
			timeoutMs: options.timeoutMs ?? 10_000,
			retry: options.retry,
			defaultHeaders: {
				"X-API-KEY": this.apiKey,
				Accept: "application/json",
				"Content-Type": "application/json",
				...options.defaultHeaders,
			},
		});
	}

	async sendMessage(
		input: Readonly<{ recipient: string; message: string; sendAt?: number }>,
	): Promise<SmsIrSendResult> {
		const result = await this.sendBulk({
			recipients: [input.recipient],
			message: input.message,
			sendAt: input.sendAt,
		});
		const first = result.messages[0];
		if (!first) throw new SmsIrError("SMS.ir returned no message result");
		return {
			...first,
			provider: "sms.ir",
			batchId: result.batchId,
			messageIds: result.messages.map((item) => item.messageId),
		};
	}

	async sendBulk(input: SmsIrBulkMessage): Promise<SmsIrBulkSendResult> {
		validateRecipients(input.recipients);
		const body = {
			lineNumber: this.lineNumber,
			messageText: validateRequiredString(input.message, "Message"),
			mobiles: input.recipients,
			sendDateTime: toUnixSeconds(input.sendAt) ?? null,
		};
		const response = await this.request("send/bulk", body);
		const result = parseSmsIrBulkResult(response, await response.text());
		return {
			provider: "sms.ir",
			batchId: result.batchId,
			cost: result.cost,
			messages: (result.messageIds ?? []).map((messageId, index) => ({
				provider: "sms.ir",
				messageId,
				status: input.sendAt === undefined ? "accepted" : "scheduled",
				recipient: input.recipients[index],
				batchId: result.batchId,
				cost: result.cost,
			})),
		};
	}

	async sendLikeToLike(input: SmsIrLikeToLikeMessage): Promise<SmsIrBulkSendResult> {
		validateRecipients(input.recipients);
		if (input.recipients.length !== input.messages.length) {
			throw new SmsIrError("SMS.ir recipients and messages must have equal lengths");
		}
		const response = await this.request("send/likeToLike", {
			lineNumber: this.lineNumber,
			messageTexts: input.messages.map((message) =>
				validateRequiredString(message, "Message"),
			),
			mobiles: input.recipients,
			sendDateTime: toUnixSeconds(input.sendAt) ?? null,
		});
		const result = parseSmsIrBulkResult(response, await response.text());
		return {
			provider: "sms.ir",
			batchId: result.batchId,
			cost: result.cost,
			messages: (result.messageIds ?? []).map((messageId, index) => ({
				provider: "sms.ir",
				messageId,
				status: input.sendAt === undefined ? "accepted" : "scheduled",
				recipient: input.recipients[index],
				batchId: result.batchId,
				cost: result.cost,
			})),
		};
	}

	async sendTemplate(input: SmsIrTemplateMessage): Promise<SmsIrSendResult> {
		if (!Number.isSafeInteger(input.templateId) || input.templateId <= 0) {
			throw new SmsIrError("SMS.ir templateId must be a positive integer");
		}
		const response = await this.request("send/verify", {
			mobile: validateRequiredString(input.recipient, "Recipient"),
			templateId: input.templateId,
			parameters: input.parameters.map(validateParameter),
		});
		return parseSmsIrSendResult(response, await response.text());
	}

	async cancelScheduled(packId: string): Promise<SmsIrCancellationResult> {
		const id = validateRequiredString(packId, "Pack ID");
		const response = await this.request(
			`send/scheduled/${encodeURIComponent(id)}`,
			undefined,
			"DELETE",
		);
		const payload = parseSmsIrPayload(response, await response.text());
		if (!isRecord(payload.data))
			throw new SmsIrError("SMS.ir response omitted cancellation data");
		return {
			provider: "sms.ir",
			batchId: id,
			returnedCredit: numberValueOptional(payload.data.returnedCreditCount),
			statusText: typeof payload.message === "string" ? payload.message : undefined,
		};
	}

	async getMessageStatus(messageId: string | number): Promise<SmsIrMessageStatus> {
		const id = validateRequiredString(String(messageId), "Message ID");
		const response = await this.request(`send/${encodeURIComponent(id)}`);
		return parseSmsIrMessageStatus(response, await response.text());
	}

	async listPacks(
		input: Readonly<{ pageNumber?: number; pageSize?: number }> = {},
	): Promise<readonly SmsIrPackSummary[]> {
		const query = new URLSearchParams();
		if (input.pageNumber !== undefined) query.set("pageNumber", String(input.pageNumber));
		if (input.pageSize !== undefined) query.set("pageSize", String(input.pageSize));
		const response = await this.request(`send/pack${query.size ? `?${query}` : ""}`);
		return parseSmsIrPackSummaries(response, await response.text());
	}

	async getPack(packId: string): Promise<readonly SmsIrPackMessage[]> {
		const id = validateRequiredString(packId, "Pack ID");
		const response = await this.request(`send/pack/${encodeURIComponent(id)}`);
		return parseSmsIrPackMessages(response, await response.text());
	}

	private async request(
		path: string,
		body?: unknown,
		method = "POST",
	): Promise<Response> {
		return this.transport.request(`${this.baseUrl}/${path}`, {
			method,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}
}

function validateParameter(parameter: SmsIrParameter): SmsIrParameter {
	return {
		name: validateRequiredString(parameter.name, "Template parameter name"),
		value: parameter.value,
	};
}

function numberValueOptional(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
