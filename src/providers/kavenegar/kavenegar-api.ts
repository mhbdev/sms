import { z } from "zod";
import type {
	KavenegarCancellationResult,
	KavenegarCountResult,
	KavenegarReceivedMessage,
	KavenegarSendResult,
	KavenegarStatusResult,
} from "../../contracts/kavenegar.js";
import { KavenegarError } from "../../errors/kavenegar-error.js";

type KavenegarEntry = Readonly<Record<string, unknown>>;

const stringLikeSchema = z.union([z.string(), z.number().finite()]);
const payloadSchema = z
	.object({
		return: z.object({
			status: z.number().finite(),
			message: stringLikeSchema.optional(),
		}),
		entries: z.unknown().optional(),
	})
	.loose();
const sendEntrySchema = z
	.object({
		messageid: z.number().finite(),
		status: z.number().finite().optional(),
		receptor: stringLikeSchema.optional(),
		sender: stringLikeSchema.optional(),
		statustext: stringLikeSchema.optional(),
		date: z.number().finite().optional(),
		cost: z.number().finite().optional(),
		message: stringLikeSchema.optional(),
	})
	.loose();
const sendArrayEntrySchema = sendEntrySchema.extend({ messageid: stringLikeSchema });
const statusEntrySchema = z
	.object({
		messageid: z.number().finite(),
		status: z.number().finite(),
		statustext: stringLikeSchema.optional(),
		localid: stringLikeSchema.optional(),
	})
	.loose();
const receivedEntrySchema = z
	.object({
		messageid: z.number().finite(),
		message: stringLikeSchema,
		sender: stringLikeSchema,
		receptor: stringLikeSchema,
		date: z.number().finite().optional(),
	})
	.loose();
const cancellationEntrySchema = z
	.object({
		messageid: stringLikeSchema.optional(),
		status: stringLikeSchema.optional(),
		statustext: stringLikeSchema.optional(),
	})
	.loose();
const countEntrySchema = z
	.object({
		startdate: z.number().finite(),
		enddate: z.number().finite(),
		sumcount: z.number().finite().optional(),
		count: z.number().finite().optional(),
	})
	.loose()
	.refine((entry) => entry.sumcount !== undefined || entry.count !== undefined);

export function parseKavenegarResponse(
	response: Response,
	rawResponse: string,
): KavenegarSendResult {
	const payload = parseKavenegarPayload(response, rawResponse);
	const entries = toEntries(
		payload.entries,
		sendEntrySchema,
		"Kavenegar returned an invalid send entry",
	);
	const entry = entries[0];
	if (!entry) throw new KavenegarError("Kavenegar did not return a sent message entry");
	return parseSendEntry(entry);
}

export function parseKavenegarSendEntries(
	response: Response,
	rawResponse: string,
): readonly KavenegarSendResult[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(
		payload.entries,
		sendEntrySchema,
		"Kavenegar returned an invalid send entry",
	).map(parseSendEntry);
}

export function parseKavenegarSendArrayResponse(
	response: Response,
	rawResponse: string,
): readonly KavenegarSendResult[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(
		payload.entries,
		sendArrayEntrySchema,
		"Kavenegar returned an invalid send-array entry",
	).map(parseSendArrayEntry);
}

export function parseKavenegarStatusResponse(
	response: Response,
	rawResponse: string,
): readonly KavenegarStatusResult[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(
		payload.entries,
		statusEntrySchema,
		"Kavenegar returned an invalid status entry",
	).map(parseStatusEntry);
}

export function parseKavenegarReceivedResponse(
	response: Response,
	rawResponse: string,
): readonly KavenegarReceivedMessage[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(
		payload.entries,
		receivedEntrySchema,
		"Kavenegar returned an invalid received-message entry",
	).map((entry) => ({
		messageId: String(numberValue(entry.messageid, "messageid")),
		message: stringValue(entry.message, "message"),
		sender: stringValue(entry.sender, "sender"),
		recipient: stringValue(entry.receptor, "receptor"),
		...(finiteNumber(entry.date) === undefined ? {} : { date: finiteNumber(entry.date) }),
	}));
}

export function parseKavenegarCancellationResponse(
	response: Response,
	rawResponse: string,
): readonly KavenegarCancellationResult[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(
		payload.entries,
		cancellationEntrySchema,
		"Kavenegar returned an invalid cancellation entry",
	).map((entry) => ({
		provider: "kavenegar",
		messageId: entry.messageid === undefined ? undefined : String(entry.messageid),
		providerStatus: entry.status === undefined ? undefined : String(entry.status),
		statusText: typeof entry.statustext === "string" ? entry.statustext : undefined,
	}));
}

export function parseKavenegarCountResponse(
	response: Response,
	rawResponse: string,
): readonly KavenegarCountResult[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(
		payload.entries,
		countEntrySchema,
		"Kavenegar returned an invalid count entry",
	).map((entry) => ({
		startDate: numberValue(entry.startdate, "startdate"),
		endDate: numberValue(entry.enddate, "enddate"),
		count: numberValue(entry.sumcount ?? entry.count, "sumcount"),
	}));
}

export function parseKavenegarPayload(
	response: Response,
	rawResponse: string,
): Readonly<{ returnStatus: number; returnMessage?: string; entries?: unknown }> {
	let value: unknown;
	try {
		value = JSON.parse(rawResponse);
	} catch (error) {
		if (!response.ok) {
			throw new KavenegarError(
				`Kavenegar request failed with status ${response.status}`,
				{
					httpStatus: response.status,
					cause: error,
				},
			);
		}
		throw new KavenegarError("Kavenegar returned a non-JSON response", { cause: error });
	}
	const parsed = payloadSchema.safeParse(value);
	if (!parsed.success) {
		const omittedStatus =
			isRecord(value) && isRecord(value.return) && !("status" in value.return);
		throw new KavenegarError(
			omittedStatus
				? "Kavenegar response omitted its status"
				: "Kavenegar returned an invalid response payload",
			{ cause: parsed.error },
		);
	}
	const status = parsed.data.return.status;
	const message = stringValueOptional(parsed.data.return.message);
	if (!response.ok || status !== 200) {
		throw new KavenegarError(message ?? "Kavenegar rejected the request", {
			httpStatus: response.status === 200 ? undefined : response.status,
			providerStatus: status,
			retryable: response.status === 429 || response.status >= 500,
		});
	}
	return {
		returnStatus: status,
		...(message === undefined ? {} : { returnMessage: message }),
		...(parsed.data.entries === undefined ? {} : { entries: parsed.data.entries }),
	};
}

function parseSendEntry(entry: KavenegarEntry): KavenegarSendResult {
	return mapSendEntry(entry, String(numberValue(entry.messageid, "messageid")));
}

function parseSendArrayEntry(entry: KavenegarEntry): KavenegarSendResult {
	const messageId = entry.messageid;
	if (typeof messageId !== "number" && typeof messageId !== "string") {
		throw new KavenegarError("Kavenegar send-array entry omitted messageid");
	}
	return mapSendEntry(entry, String(messageId));
}

function mapSendEntry(entry: KavenegarEntry, messageId: string): KavenegarSendResult {
	const status = finiteNumber(entry.status);
	return {
		provider: "kavenegar",
		messageId,
		status: "accepted",
		...(status === undefined ? {} : { providerStatus: String(status) }),
		...(stringValueOptional(entry.receptor) === undefined
			? {}
			: { recipient: stringValueOptional(entry.receptor) }),
		...(stringValueOptional(entry.sender) === undefined
			? {}
			: { sender: stringValueOptional(entry.sender) }),
		...(stringValueOptional(entry.statustext) === undefined
			? {}
			: { statusText: stringValueOptional(entry.statustext) }),
		...(finiteNumber(entry.date) === undefined ? {} : { date: finiteNumber(entry.date) }),
		...(finiteNumber(entry.cost) === undefined ? {} : { cost: finiteNumber(entry.cost) }),
		...(stringValueOptional(entry.message) === undefined
			? {}
			: { message: stringValueOptional(entry.message) }),
	};
}

function parseStatusEntry(entry: KavenegarEntry): KavenegarStatusResult {
	const messageId = String(numberValue(entry.messageid, "messageid"));
	const status = finiteNumber(entry.status);
	if (status === undefined)
		throw new KavenegarError("Kavenegar status omitted its status code");
	return {
		messageId,
		providerStatus: String(status),
		statusText: stringValueOptional(entry.statustext),
		...(stringValueOptional(entry.localid) === undefined
			? {}
			: { localId: stringValueOptional(entry.localid) }),
	};
}

function toEntries<TSchema extends z.ZodType>(
	value: unknown,
	schema: TSchema,
	invalidMessage: string,
): KavenegarEntry[] {
	const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
	return entries.map((entry) => {
		const parsed = schema.safeParse(entry);
		if (!parsed.success) {
			const field = parsed.error.issues[0]?.path[0];
			throw new KavenegarError(
				typeof field === "string"
					? `Kavenegar response omitted ${field}`
					: invalidMessage,
				{ cause: parsed.error },
			);
		}
		return parsed.data as KavenegarEntry;
	});
}

function stringValue(value: unknown, field: string): string {
	const result = stringValueOptional(value);
	if (result === undefined)
		throw new KavenegarError(`Kavenegar response omitted ${field}`);
	return result;
}

function stringValueOptional(value: unknown): string | undefined {
	return typeof value === "string" || typeof value === "number"
		? String(value)
		: undefined;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberValue(value: unknown, field: string): number {
	const result = finiteNumber(value);
	if (result === undefined)
		throw new KavenegarError(`Kavenegar response omitted ${field}`);
	return result;
}

function isRecord(value: unknown): value is KavenegarEntry {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
