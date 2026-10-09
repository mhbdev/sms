import { z } from "zod";
import type {
	KavenegarBulkRequest,
	KavenegarBulkResult,
	KavenegarCancellationResult,
	KavenegarCountQuery,
	KavenegarCountResult,
	KavenegarOutboxCountQuery,
	KavenegarReceivedMessage,
	KavenegarReceiveQuery,
	KavenegarSearchQuery,
	KavenegarSendArrayMessage,
	KavenegarSendResult,
	KavenegarSmsProviderOptions,
	KavenegarStatusQuery,
	KavenegarStatusResult,
	KavenegarTemplateMessage,
} from "../../contracts/kavenegar.js";
import type {
	SmsBulkSender,
	SmsDeliveryStatusReader,
	SmsInboxReader,
	SmsMessage,
	SmsMessageScheduler,
	SmsMessageSender,
	SmsTemplateSender,
} from "../../contracts/sms.js";
import { KavenegarError } from "../../errors/kavenegar-error.js";
import { SmsProviderError } from "../../errors/sms-error.js";
import {
	SmsHttpTransport,
	toUnixSeconds,
	validateRecipients,
	validateRequiredString,
} from "../../transport/http.js";
import {
	cancellationInputSchema,
	deliveryStatusQuerySchema,
	idsInputSchema,
	kavenegarCountQuerySchema,
	kavenegarOptionsSchema,
	kavenegarOutboxCountQuerySchema,
	kavenegarReceiveQuerySchema,
	kavenegarSearchQuerySchema,
	kavenegarSendArrayMessageSchema,
	kavenegarTemplateSchema,
	parseInput,
	signalOptionsSchema,
	smsBulkMessageSchema,
	smsMessageSchema,
} from "../../validation/schemas.js";
import {
	parseKavenegarCancellationResponse,
	parseKavenegarCountResponse,
	parseKavenegarReceivedResponse,
	parseKavenegarResponse,
	parseKavenegarSendArrayResponse,
	parseKavenegarSendEntries,
	parseKavenegarStatusResponse,
} from "./kavenegar-api.js";

const DEFAULT_BASE_URL = "https://api.kavenegar.com/v1";

export class KavenegarSmsProvider
	implements
		SmsMessageSender<SmsMessage, KavenegarSendResult>,
		SmsTemplateSender<KavenegarTemplateMessage, KavenegarSendResult>,
		SmsBulkSender<KavenegarBulkRequest, KavenegarBulkResult>,
		SmsDeliveryStatusReader<KavenegarStatusQuery, readonly KavenegarStatusResult[]>,
		SmsMessageScheduler<KavenegarCancellationResult>,
		SmsInboxReader<KavenegarReceiveQuery>
{
	readonly name = "kavenegar";
	private readonly apiKey: string;
	private readonly sender?: string;
	private readonly baseUrl: string;
	private readonly transport: SmsHttpTransport;

	constructor(options: KavenegarSmsProviderOptions) {
		const validated = parseKavenegarInput(kavenegarOptionsSchema, options);
		this.apiKey = validated.apiKey;
		this.sender = validated.sender;
		this.baseUrl = (validated.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
		this.transport = new SmsHttpTransport({
			fetcher: validated.fetcher ?? fetch,
			timeoutMs: validated.timeoutMs ?? 10_000,
			retry: validated.retry,
			defaultHeaders: validated.defaultHeaders,
		});
	}

	static toLocalRecipient(phoneNumber: string): string {
		return phoneNumber.startsWith("+98") ? `0${phoneNumber.slice(3)}` : phoneNumber;
	}

	async sendMessage(input: SmsMessage): Promise<KavenegarSendResult> {
		input = parseKavenegarInput(smsMessageSchema, input);
		const recipient = validateRequiredString(input.recipient, "Recipient");
		const text = validateRequiredString(input.message, "Message");
		const body = new URLSearchParams({
			receptor: KavenegarSmsProvider.toLocalRecipient(recipient),
			message: text,
		});
		const sender = input.sender ?? this.sender;
		if (sender) body.set("sender", sender);
		const sendAt = toUnixSeconds(input.sendAt);
		if (sendAt !== undefined) body.set("date", String(sendAt));
		if (input.localId !== undefined) body.set("localid", String(input.localId));
		if (input.tag) body.set("tag", input.tag);
		return this.requestAndParse(
			"sms/send.json",
			body,
			parseKavenegarResponse,
			input.signal,
		);
	}

	async sendTemplate(message: KavenegarTemplateMessage): Promise<KavenegarSendResult> {
		message = parseKavenegarInput(kavenegarTemplateSchema, message);
		const recipient = validateRequiredString(message.recipient, "Recipient");
		const template = validateRequiredString(
			message.template,
			"Kavenegar pattern template",
		);
		if (message.parameters.length < 1 || message.parameters.length > 3) {
			throw new KavenegarError(
				"Kavenegar templates support between one and three parameters",
			);
		}
		const body = new URLSearchParams({
			receptor: KavenegarSmsProvider.toLocalRecipient(recipient),
			token: message.parameters[0] ?? "",
			template,
			type: "sms",
		});
		if (message.parameters[1] !== undefined) body.set("token2", message.parameters[1]);
		if (message.parameters[2] !== undefined) body.set("token3", message.parameters[2]);
		return this.requestAndParse(
			"verify/lookup.json",
			body,
			parseKavenegarResponse,
			message.signal,
		);
	}

	async sendBulk(message: KavenegarBulkRequest): Promise<KavenegarBulkResult> {
		message = parseKavenegarInput(smsBulkMessageSchema, message);
		validateRecipients(message.recipients);
		const body = new URLSearchParams({
			receptor: message.recipients.map(KavenegarSmsProvider.toLocalRecipient).join(","),
			message: validateRequiredString(message.message, "Message"),
		});
		if (message.sender ?? this.sender)
			body.set("sender", message.sender ?? this.sender ?? "");
		const sendAt = toUnixSeconds(message.sendAt);
		if (sendAt !== undefined) body.set("date", String(sendAt));
		const messages = await this.requestAndParse(
			"sms/send.json",
			body,
			parseKavenegarSendEntries,
			message.signal,
		);
		return {
			provider: "kavenegar",
			messages,
			cost: messages.reduce((total, item) => total + (item.cost ?? 0), 0),
		};
	}

	async sendArray(
		messages: readonly KavenegarSendArrayMessage[],
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<readonly KavenegarSendResult[]> {
		messages = parseKavenegarInput(
			z.array(kavenegarSendArrayMessageSchema).min(1).max(200),
			messages,
		);
		options = parseKavenegarInput(signalOptionsSchema, options);
		for (const message of messages) {
			validateRequiredString(message.sender ?? this.sender ?? "", "Sender");
		}
		const body = new URLSearchParams({
			receptor: JSON.stringify(
				messages.map((item) => KavenegarSmsProvider.toLocalRecipient(item.recipient)),
			),
			sender: JSON.stringify(messages.map((item) => item.sender ?? this.sender ?? "")),
			message: JSON.stringify(
				messages.map((item) => validateRequiredString(item.message, "Message")),
			),
		});
		return this.requestAndParse(
			"sms/sendarray.json",
			body,
			parseKavenegarSendArrayResponse,
			options.signal,
		);
	}

	async getDeliveryStatus(
		query: KavenegarStatusQuery,
	): Promise<readonly KavenegarStatusResult[]> {
		query = parseKavenegarInput(deliveryStatusQuerySchema, query);
		validateIds(query.messageIds, "messageIds");
		const body = new URLSearchParams({
			messageid: query.messageIds.map(String).join(","),
		});
		return this.requestAndParse(
			"sms/status.json",
			body,
			parseKavenegarStatusResponse,
			query.signal,
		);
	}

	async getStatusByLocalId(
		localIds: readonly (string | number)[],
	): Promise<readonly KavenegarStatusResult[]> {
		localIds = parseKavenegarInput(idsInputSchema, localIds);
		validateIds(localIds, "localIds");
		return this.requestAndParse(
			"sms/statusbylocalid.json",
			new URLSearchParams({ localid: localIds.map(String).join(",") }),
			parseKavenegarStatusResponse,
		);
	}

	async cancelScheduled(
		input: Readonly<{ ids: readonly (string | number)[] }>,
	): Promise<readonly KavenegarCancellationResult[]> {
		input = parseKavenegarInput(cancellationInputSchema, input);
		validateIds(input.ids, "ids");
		const response = await this.request(
			"sms/cancel.json",
			new URLSearchParams({ messageid: input.ids.map(String).join(",") }),
		);
		return parseKavenegarCancellationResponse(response, await response.text());
	}

	async getReceivedMessages(
		query: KavenegarReceiveQuery,
	): Promise<{ items: readonly KavenegarReceivedMessage[] }> {
		query = parseKavenegarInput(kavenegarReceiveQuerySchema, query);
		validateRequiredString(query.lineNumber, "Line number");
		const response = await this.request(
			"sms/receive.json",
			new URLSearchParams({
				linenumber: query.lineNumber,
				isread: query.isRead ? "1" : "0",
			}),
			query.signal,
		);
		const raw = await response.text();
		return { items: parseKavenegarReceivedResponse(response, raw) };
	}

	async countReceivedMessages(
		query: KavenegarCountQuery,
	): Promise<readonly KavenegarCountResult[]> {
		query = parseKavenegarInput(kavenegarCountQuerySchema, query);
		const body = new URLSearchParams({ startdate: String(query.startDate) });
		if (query.endDate !== undefined) body.set("enddate", String(query.endDate));
		if (query.lineNumber) body.set("linenumber", query.lineNumber);
		if (query.isRead !== undefined) body.set("isread", query.isRead ? "1" : "0");
		return this.requestAndParse(
			"sms/countinbox.json",
			body,
			parseKavenegarCountResponse,
			query.signal,
		);
	}

	async getSentMessages(
		query: KavenegarSearchQuery,
	): Promise<readonly KavenegarSendResult[]> {
		query = parseKavenegarInput(kavenegarSearchQuerySchema, query);
		return this.getSentMessagesFrom("sms/select.json", query);
	}

	async listSentMessages(
		query: KavenegarSearchQuery,
	): Promise<readonly KavenegarSendResult[]> {
		query = parseKavenegarInput(kavenegarSearchQuerySchema, query);
		return this.getSentMessagesFrom("sms/list.json", query);
	}

	async getLatestSentMessages(
		query: KavenegarSearchQuery,
	): Promise<readonly KavenegarSendResult[]> {
		query = parseKavenegarInput(kavenegarSearchQuerySchema, query);
		return this.getSentMessagesFrom("sms/last.json", query);
	}

	async countSentMessages(
		query: KavenegarOutboxCountQuery,
	): Promise<readonly KavenegarCountResult[]> {
		query = parseKavenegarInput(kavenegarOutboxCountQuerySchema, query);
		const body = new URLSearchParams({ startdate: String(query.startDate) });
		if (query.endDate !== undefined) body.set("enddate", String(query.endDate));
		if (query.status !== undefined) body.set("status", String(query.status));
		const response = await this.request("sms/countoutbox.json", body, query.signal);
		return parseKavenegarCountResponse(response, await response.text());
	}

	private searchBody(query: KavenegarSearchQuery): URLSearchParams {
		const body = new URLSearchParams();
		if (query.messageIds?.length)
			body.set("messageid", query.messageIds.map(String).join(","));
		body.set("startdate", String(query.startDate));
		if (query.endDate !== undefined) body.set("enddate", String(query.endDate));
		if (query.lineNumber) body.set("linenumber", query.lineNumber);
		if (query.page !== undefined) body.set("page", String(query.page));
		if (query.pageSize !== undefined) body.set("pagesize", String(query.pageSize));
		return body;
	}

	private async getSentMessagesFrom(
		path: string,
		query: KavenegarSearchQuery,
	): Promise<readonly KavenegarSendResult[]> {
		return this.requestAndParse(
			path,
			this.searchBody(query),
			parseKavenegarSendEntries,
			query.signal,
		);
	}

	private async requestAndParse<T>(
		path: string,
		body: URLSearchParams,
		parse: (response: Response, rawResponse: string) => T,
		signal?: AbortSignal,
	): Promise<T> {
		const response = await this.request(path, body, signal);
		return parse(response, await response.text());
	}

	private async request(
		path: string,
		body: URLSearchParams,
		signal?: AbortSignal,
	): Promise<Response> {
		try {
			return await this.transport.request(
				`${this.baseUrl}/${this.apiKey}/${path}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
					body: body.toString(),
				},
				{ signal },
			);
		} catch (error) {
			if (error instanceof KavenegarError) throw error;
			if (error instanceof SmsProviderError) {
				throw new KavenegarError("Kavenegar request failed to send", {
					cause: error,
					httpStatus: error.httpStatus,
					providerStatus: error.providerStatus,
					retryable: error.retryable,
					retryAfterMs: error.retryAfterMs,
				});
			}
			throw new KavenegarError("Kavenegar request failed to send", { cause: error });
		}
	}
}

function parseKavenegarInput<TSchema extends z.ZodType>(
	schema: TSchema,
	value: unknown,
): z.output<TSchema> {
	return parseInput(
		schema,
		value,
		(message, cause) => new KavenegarError(message, { cause }),
	);
}

function validateIds(ids: readonly (string | number)[], name: string): void {
	if (ids.length === 0)
		throw new KavenegarError(`${name} must contain at least one identifier`);
	for (const id of ids)
		if (!String(id).trim())
			throw new KavenegarError(`${name} contains an empty identifier`);
}
