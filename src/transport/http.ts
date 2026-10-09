import type { SmsHttpFetcher } from "../contracts/http.js";
import { SmsTransportError, SmsValidationError } from "../errors/sms-error.js";

export type RetryContext = Readonly<{
	attempt: number;
	response?: Response;
	error?: unknown;
}>;

export type RetryPolicy = Readonly<{
	maxAttempts: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	backoffMultiplier?: number;
	retryOn?: (context: RetryContext) => boolean;
	sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}>;

export type RequestOptions = Readonly<{
	signal?: AbortSignal;
}>;

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);

export class SmsHttpTransport {
	private readonly fetcher: SmsHttpFetcher;
	private readonly timeoutMs: number;
	private readonly retry?: RetryPolicy;
	private readonly defaultHeaders: Readonly<Record<string, string>>;

	constructor(
		options: Readonly<{
			fetcher: SmsHttpFetcher;
			timeoutMs: number;
			retry?: RetryPolicy;
			defaultHeaders?: Readonly<Record<string, string>>;
		}>,
	) {
		if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
			throw new SmsValidationError("SMS timeout must be a positive integer");
		}
		validateRetryPolicy(options.retry);
		this.fetcher = options.fetcher;
		this.timeoutMs = options.timeoutMs;
		this.retry = options.retry;
		this.defaultHeaders = options.defaultHeaders ?? {};
	}

	async request(
		input: string | URL,
		init: RequestInit,
		options: RequestOptions = {},
	): Promise<Response> {
		const maxAttempts = this.retry?.maxAttempts ?? 1;
		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			try {
				const response = await this.fetchOnce(input, init, options);
				if (attempt < maxAttempts && this.shouldRetry({ attempt, response })) {
					await response.body?.cancel();
					await this.waitBeforeRetry(attempt, response, options.signal);
					continue;
				}
				return response;
			} catch (error) {
				if (options.signal?.aborted) {
					throw new SmsTransportError("SMS request was aborted", {
						cause: error,
						retryable: false,
					});
				}
				if (attempt < maxAttempts && this.shouldRetry({ attempt, error })) {
					await this.waitBeforeRetry(attempt, undefined, options.signal);
					continue;
				}
				if (error instanceof SmsTransportError) throw error;
				throw new SmsTransportError("SMS request failed to send", {
					cause: error,
					retryable: true,
				});
			}
		}
		throw new SmsTransportError("SMS request exhausted its retry policy");
	}

	private async fetchOnce(
		input: string | URL,
		init: RequestInit,
		options: RequestOptions,
	): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
		const externalAbort = () => controller.abort(options.signal?.reason);
		if (options.signal?.aborted) controller.abort(options.signal.reason);
		options.signal?.addEventListener("abort", externalAbort, { once: true });
		try {
			const response = await this.fetcher(input, {
				...init,
				headers: mergeHeaders(this.defaultHeaders, init.headers),
				signal: controller.signal,
			});
			if (options.signal?.aborted) {
				throw options.signal.reason ?? createAbortError();
			}
			return response;
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", externalAbort);
		}
	}

	private shouldRetry(context: RetryContext): boolean {
		if (this.retry?.retryOn) return this.retry.retryOn(context);
		if (context.response) {
			return (
				RETRYABLE_STATUS_CODES.has(context.response.status) ||
				context.response.status >= 500
			);
		}
		return context.error !== undefined;
	}

	private async waitBeforeRetry(
		attempt: number,
		response: Response | undefined,
		signal: AbortSignal | undefined,
	): Promise<void> {
		const policy = this.retry;
		if (!policy) return;
		const initialDelayMs = policy.initialDelayMs ?? 100;
		const maxDelayMs = policy.maxDelayMs ?? 5_000;
		const multiplier = policy.backoffMultiplier ?? 2;
		const retryAfter = response
			? parseRetryAfterMs(response.headers.get("retry-after"))
			: undefined;
		const backoff = Math.min(
			maxDelayMs,
			initialDelayMs * multiplier ** Math.max(0, attempt - 1),
		);
		await (policy.sleep ?? sleep)(Math.min(maxDelayMs, retryAfter ?? backoff), signal);
	}
}

function validateRetryPolicy(policy: RetryPolicy | undefined): void {
	if (!policy) return;
	if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
		throw new SmsValidationError("Retry maxAttempts must be a positive integer");
	}
	for (const [name, value] of [
		["initialDelayMs", policy.initialDelayMs],
		["maxDelayMs", policy.maxDelayMs],
	] as const) {
		if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
			throw new SmsValidationError(`Retry ${name} must be a non-negative number`);
		}
	}
	if (
		policy.backoffMultiplier !== undefined &&
		(!Number.isFinite(policy.backoffMultiplier) || policy.backoffMultiplier < 1)
	) {
		throw new SmsValidationError("Retry backoffMultiplier must be at least one");
	}
}

export function parseRetryAfterMs(value: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now());
}

async function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const timeout = setTimeout(() => {
			settled = true;
			signal?.removeEventListener("abort", abort);
			resolve();
		}, delayMs);
		const abort = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			reject(
				signal?.reason ?? new DOMException("The operation was aborted", "AbortError"),
			);
		};
		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener("abort", abort, { once: true });
	});
}

function mergeHeaders(
	defaults: Readonly<Record<string, string>>,
	initHeaders: HeadersInit | undefined,
): Headers {
	const headers = new Headers(defaults);
	new Headers(initHeaders).forEach((value, key) => {
		headers.set(key, value);
	});
	return headers;
}

function createAbortError(): DOMException {
	return new DOMException("The operation was aborted", "AbortError");
}

export function validateRequiredString(value: string, name: string): string {
	if (!value.trim()) throw new SmsValidationError(`${name} is required`);
	return value;
}

export function validateRecipients(recipients: readonly string[]): void {
	if (recipients.length === 0)
		throw new SmsValidationError("At least one recipient is required");
	for (const recipient of recipients) validateRequiredString(recipient, "Recipient");
}

export function toUnixSeconds(value: number | Date | undefined): number | undefined {
	if (value === undefined) return undefined;
	const seconds = value instanceof Date ? Math.floor(value.getTime() / 1_000) : value;
	if (!Number.isSafeInteger(seconds) || seconds < 0) {
		throw new SmsValidationError("sendAt must be a non-negative Unix timestamp");
	}
	return seconds;
}
