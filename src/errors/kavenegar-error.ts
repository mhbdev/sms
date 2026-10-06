import { SmsProviderError } from "./sms-error.js";

export class KavenegarError extends SmsProviderError {
	constructor(
		message: string,
		options: Readonly<{
			cause?: unknown;
			httpStatus?: number;
			providerStatus?: number | string;
			retryable?: boolean;
			retryAfterMs?: number;
		}> = {},
	) {
		super(message, {
			...options,
			code: "KAVENEGAR_ERROR",
		});
		this.name = "KavenegarError";
	}
}
