import type {
	KavenegarBulkRequest,
	KavenegarBulkResult,
	KavenegarCancellationResult,
	KavenegarCountQuery,
	KavenegarCountResult,
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
	SmsMessage,
	SmsMessageSender,
	SmsTemplateSender,
} from "../../contracts/sms.js";
import { KavenegarError } from "../../errors/kavenegar-error.js";
import {
	SmsHttpTransport,
	toUnixSeconds,
	validateRecipients,
	validateRequiredString,
} from "../../transport/http.js";
import {
	parseKavenegarPayload,
	parseKavenegarReceivedResponse,
	parseKavenegarResponse,
	parseKavenegarSendEntries,
	parseKavenegarStatusResponse,
} from "./kavenegar-api.js";

const DEFAULT_BASE_URL = "https://api.kavenegar.com/v1";

export class KavenegarSmsProvider
	implements SmsMessageSender, SmsTemplateSender<KavenegarTemplateMessage>
{
	readonly name = "kavenegar";
	private readonly apiKey: string;
	private readonly sender?: string;
	private readonly baseUrl: string;
	private readonly transport: SmsHttpTransport;

	constructor(options: KavenegarSmsProviderOptions) {
		if (!options.apiKey.trim()) throw new KavenegarError("Kavenegar API key is required");
		this.apiKey = options.apiKey;
		this.sender = options.sender;
		this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
		this.transport = new SmsHttpTransport({
			fetcher: options.fetcher ?? fetch,
			timeoutMs: options.timeoutMs ?? 10_000,
			retry: options.retry,
			defaultHeaders: options.defaultHeaders,
		});
	}

	static toLocalRecipient(phoneNumber: string): string {
		return phoneNumber.startsWith("+98") ? `0${phoneNumber.slice(3)}` : phoneNumber;
	}

	async sendMessage(input: SmsMessage): Promise<KavenegarSendResult> {
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
		return this.send("sms/send.json", body, input.signal);
	}

	async sendTemplate(message: KavenegarTemplateMessage): Promise<KavenegarSendResult> {
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
		return this.send("verify/lookup.json", body, message.signal);
	}

	async sendBulk(message: KavenegarBulkRequest): Promise<KavenegarBulkResult> {
		validateRecipients(message.recipients);
		const body = new URLSearchParams({
			receptor: message.recipients.map(KavenegarSmsProvider.toLocalRecipient).join(","),
			message: validateRequiredString(message.message, "Message"),
		});
		if (message.sender ?? this.sender)
			body.set("sender", message.sender ?? this.sender ?? "");
		const sendAt = toUnixSeconds(message.sendAt);
		if (sendAt !== undefined) body.set("date", String(sendAt));
		const messages = await this.sendMany("sms/send.json", body, message.signal);
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
		if (messages.length === 0)
			throw new KavenegarError("At least one batch message is required");
		const body = new URLSearchParams({
			receptor: JSON.stringify(
				messages.map((item) => KavenegarSmsProvider.toLocalRecipient(item.recipient)),
			),
			sender: JSON.stringify(messages.map((item) => item.sender ?? this.sender ?? "")),
			message: JSON.stringify(
				messages.map((item) => validateRequiredString(item.message, "Message")),
			),
		});
		const response = await this.request("sms/sendarray.json", body, options.signal);
		const raw = await response.text();
		const payload = parseKavenegarPayload(response, raw);
		const entries = Array.isArray(payload.entries)
			? payload.entries
			: payload.entries === undefined
				? []
				: [payload.entries];
		return entries.map((entry) => {
			if (!isRecord(entry))
				throw new KavenegarError("Kavenegar returned an invalid send-array entry");
			const messageId = entry.messageid;
			if (typeof messageId !== "number" && typeof messageId !== "string") {
				throw new KavenegarError("Kavenegar send-array entry omitted messageid");
			}
			return {
				provider: "kavenegar" as const,
				messageId: String(messageId),
				status: "accepted" as const,
				providerStatus: entry.status === undefined ? undefined : String(entry.status),
				statusText: typeof entry.statustext === "string" ? entry.statustext : undefined,
				recipient: typeof entry.receptor === "string" ? entry.receptor : undefined,
				sender: typeof entry.sender === "string" ? entry.sender : undefined,
				date: typeof entry.date === "number" ? entry.date : undefined,
				cost: typeof entry.cost === "number" ? entry.cost : undefined,
				message: typeof entry.message === "string" ? entry.message : undefined,
			};
		});
	}

	async getDeliveryStatus(
		query: KavenegarStatusQuery,
	): Promise<readonly KavenegarStatusResult[]> {
		validateIds(query.messageIds, "messageIds");
		const body = new URLSearchParams({
			messageid: query.messageIds.map(String).join(","),
		});
		return this.parseStatusRequest("sms/status.json", body, query.signal);
	}

	async getStatusByLocalId(
		localIds: readonly (string | number)[],
	): Promise<readonly KavenegarStatusResult[]> {
		validateIds(localIds, "localIds");
		return this.parseStatusRequest(
			"sms/statusbylocalid.json",
			new URLSearchParams({ localid: localIds.map(String).join(",") }),
		);
	}

	async cancelScheduled(
		input: Readonly<{ ids: readonly (string | number)[] }>,
	): Promise<readonly KavenegarCancellationResult[]> {
		validateIds(input.ids, "ids");
		const response = await this.request(
			"sms/cancel.json",
			new URLSearchParams({ messageid: input.ids.map(String).join(",") }),
		);
		const raw = await response.text();
		const payload = parseKavenegarPayload(response, raw);
		return toEntries(payload.entries).map((entry) => ({
			provider: "kavenegar",
			messageId: entry.messageid === undefined ? undefined : String(entry.messageid),
			providerStatus: entry.status === undefined ? undefined : String(entry.status),
			statusText: typeof entry.statustext === "string" ? entry.statustext : undefined,
		}));
	}

	async getReceivedMessages(
		query: KavenegarReceiveQuery,
	): Promise<{ items: readonly KavenegarReceivedMessage[] }> {
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
		const body = new URLSearchParams({ startdate: String(query.startDate) });
		if (query.endDate !== undefined) body.set("enddate", String(query.endDate));
		if (query.lineNumber) body.set("linenumber", query.lineNumber);
		if (query.isRead !== undefined) body.set("isread", query.isRead ? "1" : "0");
		const response = await this.request("sms/countinbox.json", body, query.signal);
		const raw = await response.text();
		const payload = parseKavenegarPayload(response, raw);
		return toEntries(payload.entries).map((entry) => ({
			startDate: numberValue(entry.startdate, "startdate"),
			endDate: numberValue(entry.enddate, "enddate"),
			count: numberValue(entry.sumcount, "sumcount"),
		}));
	}

	async getSentMessages(
		query: KavenegarSearchQuery,
	): Promise<readonly KavenegarSendResult[]> {
		const body = this.searchBody(query);
		const response = await this.request("sms/select.json", body, query.signal);
		return parseKavenegarSendEntries(response, await response.text());
	}

	async listSentMessages(
		query: KavenegarSearchQuery,
	): Promise<readonly KavenegarSendResult[]> {
		const response = await this.request(
			"sms/list.json",
			this.searchBody(query),
			query.signal,
		);
		return parseKavenegarSendEntries(response, await response.text());
	}

	async getLatestSentMessages(
		query: KavenegarSearchQuery,
	): Promise<readonly KavenegarSendResult[]> {
		const response = await this.request(
			"sms/last.json",
			this.searchBody(query),
			query.signal,
		);
		return parseKavenegarSendEntries(response, await response.text());
	}

	async countSentMessages(
		query: KavenegarSearchQuery,
	): Promise<readonly KavenegarCountResult[]> {
		const response = await this.request(
			"sms/count.json",
			this.searchBody(query),
			query.signal,
		);
		const payload = parseKavenegarPayload(response, await response.text());
		return toEntries(payload.entries).map((entry) => ({
			startDate: numberValue(entry.startdate, "startdate"),
			endDate: numberValue(entry.enddate, "enddate"),
			count: numberValue(entry.sumcount ?? entry.count, "sumcount"),
		}));
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

	private async parseStatusRequest(
		path: string,
		body: URLSearchParams,
		signal?: AbortSignal,
	): Promise<readonly KavenegarStatusResult[]> {
		const response = await this.request(path, body, signal);
		return parseKavenegarStatusResponse(response, await response.text());
	}

	private async send(
		path: string,
		body: URLSearchParams,
		signal?: AbortSignal,
	): Promise<KavenegarSendResult> {
		const response = await this.request(path, body, signal);
		return parseKavenegarResponse(response, await response.text());
	}

	private async sendMany(
		path: string,
		body: URLSearchParams,
		signal?: AbortSignal,
	): Promise<readonly KavenegarSendResult[]> {
		const response = await this.request(path, body, signal);
		return parseKavenegarSendEntries(response, await response.text());
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
			throw new KavenegarError("Kavenegar request failed to send", { cause: error });
		}
	}
}

function validateIds(ids: readonly (string | number)[], name: string): void {
	if (ids.length === 0)
		throw new KavenegarError(`${name} must contain at least one identifier`);
	for (const id of ids)
		if (!String(id).trim())
			throw new KavenegarError(`${name} contains an empty identifier`);
}

function toEntries(value: unknown): Readonly<Record<string, unknown>>[] {
	if (Array.isArray(value)) return value.filter(isRecord);
	return isRecord(value) ? [value] : [];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new KavenegarError(`Kavenegar response omitted ${field}`);
	return value;
}
