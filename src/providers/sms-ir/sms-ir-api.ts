import type {
	SmsIrMessageStatus,
	SmsIrPackMessage,
	SmsIrPackSummary,
	SmsIrSendResult,
} from "../../contracts/sms-ir.js";
import { SmsIrError } from "../../errors/sms-ir-error.js";

type SmsIrPayload = Readonly<{ status: number; message?: string; data?: unknown }>;

export function parseSmsIrPayload(response: Response, rawResponse: string): SmsIrPayload {
	let value: unknown;
	try {
		value = JSON.parse(rawResponse);
	} catch (error) {
		throw new SmsIrError("SMS.ir returned a non-JSON response", {
			httpStatus: response.status,
			cause: error,
		});
	}
	if (!isRecord(value) || typeof value.status !== "number") {
		throw new SmsIrError("SMS.ir returned an invalid response payload", {
			httpStatus: response.status,
		});
	}
	const message = typeof value.message === "string" ? value.message : undefined;
	if (!response.ok || value.status !== 1) {
		throw new SmsIrError(message ?? "SMS.ir rejected the request", {
			httpStatus: response.status,
			providerStatus: value.status,
			retryable: response.status === 429 || response.status >= 500,
		});
	}
	return {
		status: value.status,
		...(message === undefined ? {} : { message }),
		...(value.data === undefined ? {} : { data: value.data }),
	};
}

export function parseSmsIrSendResult(
	response: Response,
	rawResponse: string,
): SmsIrSendResult {
	const payload = parseSmsIrPayload(response, rawResponse);
	if (!isRecord(payload.data)) throw new SmsIrError("SMS.ir response omitted send data");
	const messageId = stringNumberValue(payload.data.messageId, "messageId");
	const cost = numberValueOptional(payload.data.cost);
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
	if (!isRecord(payload.data)) throw new SmsIrError("SMS.ir response omitted bulk data");
	const batchId = stringValue(payload.data.packId, "packId");
	const ids = Array.isArray(payload.data.messageIds)
		? payload.data.messageIds.map((value) =>
				value === null ? null : stringNumberValue(value, "messageIds"),
			)
		: [];
	const cost = numberValueOptional(payload.data.cost);
	return {
		provider: "sms.ir",
		messageId: ids[0] ?? null,
		status: "accepted",
		batchId,
		messageIds: ids,
		...(cost === undefined ? {} : { cost }),
	};
}

export function parseSmsIrMessageStatus(
	response: Response,
	rawResponse: string,
): SmsIrMessageStatus {
	const payload = parseSmsIrPayload(response, rawResponse);
	if (!isRecord(payload.data))
		throw new SmsIrError("SMS.ir response omitted message status data");
	return {
		messageId: stringNumberValue(payload.data.messageId, "messageId"),
		recipient: stringNumberValue(payload.data.mobile, "mobile"),
		...(typeof payload.data.messageText === "string"
			? { message: payload.data.messageText }
			: {}),
		...(numberValueOptional(payload.data.sendDateTime) === undefined
			? {}
			: { sentAt: numberValueOptional(payload.data.sendDateTime) }),
		...(numberValueOptional(payload.data.lineNumber) === undefined
			? {}
			: { lineNumber: String(numberValueOptional(payload.data.lineNumber)) }),
		...(numberValueOptional(payload.data.cost) === undefined
			? {}
			: { cost: numberValueOptional(payload.data.cost) }),
		...(payload.data.deliveryState === null || payload.data.deliveryState === undefined
			? {}
			: { deliveryStatus: String(payload.data.deliveryState) }),
		...(numberValueOptional(payload.data.deliveryDateTime) === undefined
			? {}
			: { deliveredAt: numberValueOptional(payload.data.deliveryDateTime) }),
	};
}

export function parseSmsIrPackSummaries(
	response: Response,
	rawResponse: string,
): readonly SmsIrPackSummary[] {
	const payload = parseSmsIrPayload(response, rawResponse);
	if (!Array.isArray(payload.data))
		throw new SmsIrError("SMS.ir response omitted pack data");
	return payload.data.map((value) => {
		if (!isRecord(value)) throw new SmsIrError("SMS.ir returned an invalid pack entry");
		return {
			packId: stringValue(value.packId, "packId"),
			recipientCount: numberValue(value.recipientCount, "recipientCount"),
			createdAt: numberValue(value.creationDateTime, "creationDateTime"),
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
		return {
			messageId: stringNumberValue(value.messageId, "messageId"),
			recipient: stringNumberValue(value.mobile, "mobile"),
			...(typeof value.messageText === "string" ? { message: value.messageText } : {}),
			...(numberValueOptional(value.sendDateTime) === undefined
				? {}
				: { sentAt: numberValueOptional(value.sendDateTime) }),
			...(numberValueOptional(value.lineNumber) === undefined
				? {}
				: { lineNumber: String(numberValueOptional(value.lineNumber)) }),
			...(numberValueOptional(value.cost) === undefined
				? {}
				: { cost: numberValueOptional(value.cost) }),
			...(value.deliveryState === null || value.deliveryState === undefined
				? {}
				: { deliveryStatus: String(value.deliveryState) }),
			...(numberValueOptional(value.deliveryDateTime) === undefined
				? {}
				: { deliveredAt: numberValueOptional(value.deliveryDateTime) }),
		};
	});
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
