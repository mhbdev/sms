export type SmsErrorOptions = Readonly<{
	cause?: unknown;
	code?: string;
	httpStatus?: number;
	providerStatus?: number | string;
	retryable?: boolean;
	retryAfterMs?: number;
}>;

export class SmsProviderError extends Error {
	readonly code: string;
	readonly isOperational = true;
	readonly httpStatus?: number;
	readonly providerStatus?: number | string;
	readonly retryable?: boolean;
	readonly retryAfterMs?: number;

	constructor(message: string, options: SmsErrorOptions = {}) {
		super(message, { cause: options.cause });
		this.name = "SmsProviderError";
		this.code = options.code ?? "SMS_PROVIDER_ERROR";
		this.httpStatus = options.httpStatus;
		this.providerStatus = options.providerStatus;
		this.retryable = options.retryable;
		this.retryAfterMs = options.retryAfterMs;
	}
}

export class SmsValidationError extends SmsProviderError {
	constructor(message: string, options: Omit<SmsErrorOptions, "code"> = {}) {
		super(message, { ...options, code: "SMS_VALIDATION_ERROR", retryable: false });
		this.name = "SmsValidationError";
	}
}

export class SmsTransportError extends SmsProviderError {
	constructor(message: string, options: Omit<SmsErrorOptions, "code"> = {}) {
		super(message, { ...options, code: "SMS_TRANSPORT_ERROR" });
		this.name = "SmsTransportError";
	}
}
