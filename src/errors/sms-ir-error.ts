import { SmsProviderError } from "./sms-error";

export class SmsIrError extends SmsProviderError {
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
			code: "SMS_IR_ERROR",
		});
		this.name = "SmsIrError";
	}
}
