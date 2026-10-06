import type {
	KavenegarReceivedMessage,
	KavenegarSendResult,
	KavenegarStatusResult,
} from "../../contracts/kavenegar.js";
import { KavenegarError } from "../../errors/kavenegar-error.js";

type KavenegarEntry = Readonly<Record<string, unknown>>;

export function parseKavenegarResponse(
	response: Response,
	rawResponse: string,
): KavenegarSendResult {
	const payload = parseKavenegarPayload(response, rawResponse);
	const entries = toEntries(payload.entries);
	const entry = entries[0];
	if (!entry) throw new KavenegarError("Kavenegar did not return a sent message entry");
	return parseSendEntry(entry);
}

export function parseKavenegarSendEntries(
	response: Response,
	rawResponse: string,
): readonly KavenegarSendResult[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(payload.entries).map(parseSendEntry);
}

export function parseKavenegarStatusResponse(
	response: Response,
	rawResponse: string,
): readonly KavenegarStatusResult[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(payload.entries).map(parseStatusEntry);
}

export function parseKavenegarReceivedResponse(
	response: Response,
	rawResponse: string,
): readonly KavenegarReceivedMessage[] {
	const payload = parseKavenegarPayload(response, rawResponse);
	return toEntries(payload.entries).map((entry) => ({
		messageId: String(numberValue(entry.messageid, "messageid")),
		message: stringValue(entry.message, "message"),
		sender: stringValue(entry.sender, "sender"),
		recipient: stringValue(entry.receptor, "receptor"),
		...(finiteNumber(entry.date) === undefined ? {} : { date: finiteNumber(entry.date) }),
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
	if (!isRecord(value) || !isRecord(value.return)) {
		throw new KavenegarError("Kavenegar returned an invalid response payload");
	}
	const status = finiteNumber(value.return.status);
	const message = stringValueOptional(value.return.message);
	if (status === undefined)
		throw new KavenegarError("Kavenegar response omitted its status");
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
		...("entries" in value ? { entries: value.entries } : {}),
	};
}

function parseSendEntry(entry: KavenegarEntry): KavenegarSendResult {
	const messageId = String(numberValue(entry.messageid, "messageid"));
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

function toEntries(value: unknown): KavenegarEntry[] {
	if (Array.isArray(value)) return value.filter(isRecord);
	return isRecord(value) ? [value] : [];
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
