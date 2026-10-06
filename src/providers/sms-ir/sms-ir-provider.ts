import type { z } from "zod";
import type {
	SmsBulkSender,
	SmsDeliveryStatus,
	SmsDeliveryStatusReader,
	SmsMessageSender,
	SmsPackScheduler,
	SmsTemplateSender,
} from "../../contracts/sms.js";
import type {
	SmsIrBulkMessage,
	SmsIrBulkSendResult,
	SmsIrCancellationResult,
	SmsIrLikeToLikeMessage,
	SmsIrMessage,
	SmsIrMessageStatus,
	SmsIrPackMessage,
	SmsIrPackQuery,
	SmsIrPackSummary,
	SmsIrParameter,
	SmsIrProviderOptions,
	SmsIrSendResult,
	SmsIrStatusQuery,
	SmsIrTemplateMessage,
} from "../../contracts/sms-ir.js";
import { SmsIrError } from "../../errors/sms-ir-error.js";
import {
	SmsHttpTransport,
	toUnixSeconds,
	validateRecipients,
	validateRequiredString,
} from "../../transport/http.js";
import {
	deliveryStatusQuerySchema,
	localIdSchema,
	packQuerySchema,
	parseInput,
	signalOptionsSchema,
	smsIrBulkMessageSchema,
	smsIrLikeToLikeSchema,
	smsIrMessageSchema,
	smsIrOptionsSchema,
	smsIrTemplateSchema,
} from "../../validation/schemas.js";
import {
	parseSmsIrBulkResult,
	parseSmsIrCancellationResult,
	parseSmsIrMessageStatus,
	parseSmsIrPackMessages,
	parseSmsIrPackSummaries,
	parseSmsIrSendResult,
} from "./sms-ir-api.js";

const DEFAULT_BASE_URL = "https://api.sms.ir/v1";

export class SmsIrProvider
	implements
		SmsMessageSender<SmsIrMessage, SmsIrSendResult>,
		SmsTemplateSender<SmsIrTemplateMessage, SmsIrSendResult>,
		SmsBulkSender<SmsIrBulkMessage, SmsIrBulkSendResult>,
		SmsDeliveryStatusReader<SmsIrStatusQuery, readonly SmsDeliveryStatus[]>,
		SmsPackScheduler<SmsIrCancellationResult>
{
	readonly name = "sms.ir";
	private readonly apiKey: string;
	private readonly lineNumber: string;
	private readonly baseUrl: string;
	private readonly transport: SmsHttpTransport;

	constructor(options: SmsIrProviderOptions) {
		const validated = parseSmsIrInput(smsIrOptionsSchema, options);
		this.apiKey = validated.apiKey;
		this.lineNumber = String(validated.lineNumber);
		validateRequiredString(this.lineNumber, "SMS.ir line number");
		this.baseUrl = (validated.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
		this.transport = new SmsHttpTransport({
			fetcher: validated.fetcher ?? fetch,
			timeoutMs: validated.timeoutMs ?? 10_000,
			retry: validated.retry,
			defaultHeaders: {
				"X-API-KEY": this.apiKey,
				Accept: "application/json",
				"Content-Type": "application/json",
				...validated.defaultHeaders,
			},
		});
	}

	async sendMessage(input: SmsIrMessage): Promise<SmsIrSendResult> {
		input = parseSmsIrInput(smsIrMessageSchema, input);
		const result = await this.sendBulk({
			recipients: [input.recipient],
			message: input.message,
			sendAt: input.sendAt,
			signal: input.signal,
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
		input = parseSmsIrInput(smsIrBulkMessageSchema, input);
		validateRecipients(input.recipients);
		const body = {
			lineNumber: this.lineNumber,
			messageText: validateRequiredString(input.message, "Message"),
			mobiles: input.recipients,
			sendDateTime: toUnixSeconds(input.sendAt) ?? null,
		};
		const response = await this.request("send/bulk", body, "POST", input.signal);
		const result = parseSmsIrBulkResult(response, await response.text());
		return this.toBulkSendResult(input.recipients, input.sendAt, result);
	}

	async sendLikeToLike(input: SmsIrLikeToLikeMessage): Promise<SmsIrBulkSendResult> {
		input = parseSmsIrInput(smsIrLikeToLikeSchema, input);
		validateRecipients(input.recipients);
		if (input.recipients.length !== input.messages.length) {
			throw new SmsIrError("SMS.ir recipients and messages must have equal lengths");
		}
		const response = await this.request(
			"send/likeToLike",
			{
				lineNumber: this.lineNumber,
				messageTexts: input.messages.map((message) =>
					validateRequiredString(message, "Message"),
				),
				mobiles: input.recipients,
				sendDateTime: toUnixSeconds(input.sendAt) ?? null,
			},
			"POST",
			input.signal,
		);
		const result = parseSmsIrBulkResult(response, await response.text());
		return this.toBulkSendResult(input.recipients, input.sendAt, result);
	}

	async sendTemplate(input: SmsIrTemplateMessage): Promise<SmsIrSendResult> {
		input = parseSmsIrInput(smsIrTemplateSchema, input);
		if (!Number.isSafeInteger(input.templateId) || input.templateId <= 0) {
			throw new SmsIrError("SMS.ir templateId must be a positive integer");
		}
		const response = await this.request(
			"send/verify",
			{
				mobile: validateRequiredString(input.recipient, "Recipient"),
				templateId: input.templateId,
				parameters: input.parameters.map(validateParameter),
			},
			"POST",
			input.signal,
		);
		return parseSmsIrSendResult(response, await response.text());
	}

	async cancelScheduled(packId: string): Promise<SmsIrCancellationResult> {
		return this.cancelScheduledPack(packId);
	}

	async cancelScheduledPack(
		packId: string,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<SmsIrCancellationResult> {
		packId = parseSmsIrInput(localIdSchema, packId).toString();
		options = parseSmsIrInput(signalOptionsSchema, options);
		const id = validateRequiredString(packId, "Pack ID");
		const response = await this.request(
			`send/scheduled/${encodeURIComponent(id)}`,
			undefined,
			"DELETE",
			options.signal,
		);
		return parseSmsIrCancellationResult(response, await response.text(), id);
	}

	async getMessageStatus(
		messageId: string | number,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<SmsIrMessageStatus> {
		messageId = parseSmsIrInput(localIdSchema, messageId);
		options = parseSmsIrInput(signalOptionsSchema, options);
		const id = validateRequiredString(String(messageId), "Message ID");
		const response = await this.request(
			`send/${encodeURIComponent(id)}`,
			undefined,
			"GET",
			options.signal,
		);
		return parseSmsIrMessageStatus(response, await response.text());
	}

	async getDeliveryStatus(
		query: SmsIrStatusQuery,
	): Promise<readonly SmsDeliveryStatus[]> {
		query = parseSmsIrInput(deliveryStatusQuerySchema, query);
		if (query.messageIds.length === 0)
			throw new SmsIrError("messageIds must contain at least one identifier");
		const statuses = await Promise.all(
			query.messageIds.map((messageId) =>
				this.getMessageStatus(messageId, { signal: query.signal }),
			),
		);
		return statuses.map((status) => ({
			messageId: status.messageId,
			providerStatus: status.deliveryStatus ?? "unknown",
			...(status.deliveredAt === undefined ? {} : { deliveredAt: status.deliveredAt }),
			recipient: status.recipient,
		}));
	}

	async listPacks(input: SmsIrPackQuery = {}): Promise<readonly SmsIrPackSummary[]> {
		input = parseSmsIrInput(packQuerySchema, input);
		const query = new URLSearchParams();
		if (input.pageNumber !== undefined) query.set("pageNumber", String(input.pageNumber));
		if (input.pageSize !== undefined) query.set("pageSize", String(input.pageSize));
		const response = await this.request(
			`send/pack${query.size ? `?${query}` : ""}`,
			undefined,
			"GET",
			input.signal,
		);
		return parseSmsIrPackSummaries(response, await response.text());
	}

	async getPack(
		packId: string,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<readonly SmsIrPackMessage[]> {
		packId = parseSmsIrInput(localIdSchema, packId).toString();
		options = parseSmsIrInput(signalOptionsSchema, options);
		const id = validateRequiredString(packId, "Pack ID");
		const response = await this.request(
			`send/pack/${encodeURIComponent(id)}`,
			undefined,
			"GET",
			options.signal,
		);
		return parseSmsIrPackMessages(response, await response.text());
	}

	private async request(
		path: string,
		body?: unknown,
		method = "POST",
		signal?: AbortSignal,
	): Promise<Response> {
		return this.transport.request(
			`${this.baseUrl}/${path}`,
			{
				method,
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ signal },
		);
	}

	private toBulkSendResult(
		recipients: readonly string[],
		sendAt: number | Date | undefined,
		result: SmsIrSendResult,
	): SmsIrBulkSendResult {
		return {
			provider: "sms.ir",
			batchId: result.batchId,
			cost: result.cost,
			messages: (result.messageIds ?? []).map((messageId, index) => ({
				provider: "sms.ir",
				messageId,
				status: sendAt === undefined ? "accepted" : "scheduled",
				recipient: recipients[index],
				batchId: result.batchId,
				cost: result.cost,
			})),
		};
	}
}

function parseSmsIrInput<TSchema extends z.ZodType>(
	schema: TSchema,
	value: unknown,
): z.output<TSchema> {
	return parseInput(
		schema,
		value,
		(message, cause) => new SmsIrError(message, { cause }),
	);
}

function validateParameter(parameter: SmsIrParameter): SmsIrParameter {
	return {
		name: validateRequiredString(parameter.name, "Template parameter name"),
		value: parameter.value,
	};
}
