import type { SmsHttpOptions } from "./http";
import type {
	SmsBulkMessage,
	SmsBulkSendResult,
	SmsCancellationResult,
	SmsDeliveryStatusQuery,
	SmsSendResult,
} from "./sms";

export type SmsIrProviderOptions = Readonly<
	SmsHttpOptions & {
		apiKey: string;
		lineNumber: string | number;
	}
>;

export type SmsIrParameter = Readonly<{
	name: string;
	value: string;
}>;

export type SmsIrTemplateMessage = Readonly<{
	recipient: string;
	templateId: number;
	parameters: readonly SmsIrParameter[];
}>;

export type SmsIrSendResult = SmsSendResult &
	Readonly<{
		provider: "sms.ir";
		cost?: number;
		batchId?: string;
		messageIds?: readonly (string | null)[];
	}>;

export type SmsIrBulkMessage = SmsBulkMessage;
export type SmsIrBulkSendResult = SmsBulkSendResult;
export type SmsIrStatusQuery = SmsDeliveryStatusQuery;
export type SmsIrCancellationResult = SmsCancellationResult;

export type SmsIrLikeToLikeMessage = Readonly<{
	recipients: readonly string[];
	messages: readonly string[];
	sendAt?: number;
}>;

export type SmsIrMessageStatus = Readonly<{
	messageId: string;
	recipient: string;
	message?: string;
	sentAt?: number;
	lineNumber?: string;
	cost?: number;
	deliveryStatus?: string;
	deliveredAt?: number;
}>;

export type SmsIrPackSummary = Readonly<{
	packId: string;
	recipientCount: number;
	createdAt: number;
}>;

export type SmsIrPackMessage = SmsIrMessageStatus;
