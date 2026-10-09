import { z } from "zod";
import type {
	SmsIrCancellationResult,
	SmsIrMessageStatus,
	SmsIrPackMessage,
	SmsIrPackSummary,
	SmsIrSendResult,
} from "../../contracts/sms-ir.js";
import { SmsIrError } from "../../errors/sms-ir-error.js";
import { parseRetryAfterMs } from "../../transport/http.js";

type SmsIrPayload = Readonly<{ status: number; message?: string; data?: unknown }>;

const stringLikeSchema = z.union([z.string(), z.number().finite()]);
const payloadSchema = z
	.object({
		status: z.number().finite(),
		message: z.string().optional(),
		data: z.unknown().optional(),
	})
	.loose();
const sendDataSchema = z
	.object({
		messageId: stringLikeSchema,
		cost: z.number().finite().optional(),
	})
	.loose();
const bulkDataSchema = z
	.object({
		packId: stringLikeSchema,
		messageIds: z.array(z.union([stringLikeSchema, z.null()])).min(1),
		cost: z.number().finite().optional(),
	})
	.loose();
const messageDataSchema = z
	.object({
		messageId: stringLikeSchema,
		mobile: stringLikeSchema,
		messageText: z.string().optional(),
		sendDateTime: z.number().finite().optional(),
		lineNumber: z.number().finite().optional(),
		cost: z.number().finite().optional(),
		deliveryState: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
		deliveryDateTime: z.number().finite().optional(),
	})
	.loose();
const packSummarySchema = z
	.object({
		packId: stringLikeSchema,
		recipientCount: z.number().finite(),
		creationDateTime: z.number().finite(),
	})
	.loose();
const cancellationDataSchema = z
	.object({
		returnedCreditCount: z.number().finite().optional(),
		smsCount: z.number().finite().optional(),
	})
	.loose();

export function parseSmsIrPayload(response: Response, rawResponse: string): SmsIrPayload {
	let value: unknown;
	try {
		value = JSON.parse(rawResponse);
	} catch (error) {
		throw new SmsIrError("SMS.ir returned a non-JSON response", {
			httpStatus: response.status,
			cause: error,
			retryable: response.status === 429 || response.status >= 500,
			retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
		});
	}
	const parsed = payloadSchema.safeParse(value);
	if (!parsed.success) {
		throw new SmsIrError("SMS.ir returned an invalid response payload", {
			httpStatus: response.status,
			cause: parsed.error,
			retryable: response.status === 429 || response.status >= 500,
			retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
		});
	}
	const message = parsed.data.message;
	if (!response.ok || parsed.data.status !== 1) {
		throw new SmsIrError(message ?? "SMS.ir rejected the request", {
			httpStatus: response.status,
			providerStatus: parsed.data.status,
			retryable: response.status === 429 || response.status >= 500,
			retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
		});
	}
	return {
		status: parsed.data.status,
		...(message === undefined ? {} : { message }),
		...(parsed.data.data === undefined ? {} : { data: parsed.data.data }),
	};
}

export function parseSmsIrSendResult(
	response: Response,
	rawResponse: string,
): SmsIrSendResult {
	const payload = parseSmsIrPayload(response, rawResponse);
	const data = parseSmsIrData(
		sendDataSchema,
		payload.data,
		"SMS.ir response omitted send data",
	);
	const messageId = stringNumberValue(data.messageId, "messageId");
	const cost = numberValueOptional(data.cost);
	return {
		provider: "sms.ir",
		messageId,
		status: "accepted",
		...(cost === undefined ? {} : { cost }),
		...(payload.message === undefined ? {} : { providerMessage: payload.message }),
	};
}

export function parseSmsIrBulkResult(
	response: Response,
	rawResponse: string,
): SmsIrSendResult {
	const payload = parseSmsIrPayload(response, rawResponse);
	const data = parseSmsIrData(
		bulkDataSchema,
		payload.data,
		"SMS.ir response omitted bulk data",
	);
	const batchId = stringValue(data.packId, "packId");
	const ids = data.messageIds
		? data.messageIds.map((value) =>
				value === null ? null : stringNumberValue(value, "messageIds"),
			)
		: [];
	const cost = numberValueOptional(data.cost);
	return {
		provider: "sms.ir",
		messageId: ids[0] ?? null,
		status: "accepted",
		batchId,
		messageIds: ids,
		...(cost === undefined ? {} : { cost }),
	};
}

export function parseSmsIrCancellationResult(
	response: Response,
	rawResponse: string,
	batchId: string,
): SmsIrCancellationResult {
	const payload = parseSmsIrPayload(response, rawResponse);
	const data = parseSmsIrData(
		cancellationDataSchema,
		payload.data,
		"SMS.ir response omitted cancellation data",
	);
	return {
		provider: "sms.ir",
		batchId,
		returnedCredit: numberValueOptional(data.returnedCreditCount),
		statusText: payload.message,
	};
}

export function parseSmsIrMessageStatus(
	response: Response,
	rawResponse: string,
): SmsIrMessageStatus {
	const payload = parseSmsIrPayload(response, rawResponse);
	return parseSmsIrMessageData(payload.data);
}

export function parseSmsIrPackSummaries(
	response: Response,
	rawResponse: string,
): readonly SmsIrPackSummary[] {
	const payload = parseSmsIrPayload(response, rawResponse);
	if (!Array.isArray(payload.data))
		throw new SmsIrError("SMS.ir response omitted pack data");
	return payload.data.map((value) => {
		const entry = parseSmsIrData(
			packSummarySchema,
			value,
			"SMS.ir returned an invalid pack entry",
		);
		return {
			packId: stringValue(entry.packId, "packId"),
			recipientCount: numberValue(entry.recipientCount, "recipientCount"),
			createdAt: numberValue(entry.creationDateTime, "creationDateTime"),
		};
	});
}

export function parseSmsIrPackMessages(
	response: Response,
	rawResponse: string,
): readonly SmsIrPackMessage[] {
	const payload = parseSmsIrPayload(response, rawResponse);
	if (!Array.isArray(payload.data))
		throw new SmsIrError("SMS.ir response omitted pack message data");
	return payload.data.map((value) => {
		if (!isRecord(value)) throw new SmsIrError("SMS.ir returned an invalid pack message");
		return parseSmsIrMessageData(value);
	});
}

function parseSmsIrMessageData(data: unknown): SmsIrMessageStatus {
	const entry = parseSmsIrData(
		messageDataSchema,
		data,
		"SMS.ir response omitted message status data",
	);
	const sentAt = numberValueOptional(entry.sendDateTime);
	const lineNumber = numberValueOptional(entry.lineNumber);
	const cost = numberValueOptional(entry.cost);
	const deliveredAt = numberValueOptional(entry.deliveryDateTime);
	return {
		messageId: stringNumberValue(entry.messageId, "messageId"),
		recipient: stringNumberValue(entry.mobile, "mobile"),
		...(typeof entry.messageText === "string" ? { message: entry.messageText } : {}),
		...(sentAt === undefined ? {} : { sentAt }),
		...(lineNumber === undefined ? {} : { lineNumber: String(lineNumber) }),
		...(cost === undefined ? {} : { cost }),
		...(entry.deliveryState === null || entry.deliveryState === undefined
			? {}
			: { deliveryStatus: String(entry.deliveryState) }),
		...(deliveredAt === undefined ? {} : { deliveredAt }),
	};
}

function parseSmsIrData<TSchema extends z.ZodType>(
	schema: TSchema,
	value: unknown,
	message: string,
): z.output<TSchema> {
	const result = schema.safeParse(value);
	if (!result.success) throw new SmsIrError(message, { cause: result.error });
	return result.data;
}

function stringValue(value: unknown, field: string): string {
	const result =
		typeof value === "string" || typeof value === "number" ? String(value) : undefined;
	if (!result) throw new SmsIrError(`SMS.ir response omitted ${field}`);
	return result;
}

function stringNumberValue(value: unknown, field: string): string {
	return stringValue(value, field);
}

function numberValue(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new SmsIrError(`SMS.ir response omitted ${field}`);
	return value;
}

function numberValueOptional(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
