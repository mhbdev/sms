import { SmsProviderError } from "./sms-error.js";

export class SmsIrError extends SmsProviderError {
	constructor(
		message: string,
		options: Readonly<{
			cause?: unknown;
			httpStatus?: number;
			providerStatus?: number | string;
			retryable?: boolean;
			retryAfterMs?: number;
			deliveryOutcome?: "rejected" | "unknown";
		}> = {},
	) {
		super(message, {
			...options,
			code: "SMS_IR_ERROR",
		});
		this.name = "SmsIrError";
	}
}
