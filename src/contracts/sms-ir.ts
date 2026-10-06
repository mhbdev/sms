import type { SmsHttpOptions } from "./http.js";
import type {
	SmsBulkMessage,
	SmsBulkSendResult,
	SmsCancellationResult,
	SmsDeliveryStatusQuery,
	SmsMessage,
	SmsSendResult,
} from "./sms.js";

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
	signal?: AbortSignal;
}>;

export type SmsIrMessage = Omit<SmsMessage, "sender" | "localId" | "tag">;

export type SmsIrSendResult = SmsSendResult &
	Readonly<{
		provider: "sms.ir";
		cost?: number;
		batchId?: string;
		messageIds?: readonly (string | null)[];
	}>;

export type SmsIrBulkMessage = Omit<SmsBulkMessage, "sender">;
export type SmsIrBulkSendResult = SmsBulkSendResult;
export type SmsIrStatusQuery = SmsDeliveryStatusQuery;
export type SmsIrCancellationResult = SmsCancellationResult;

export type SmsIrLikeToLikeMessage = Readonly<{
	recipients: readonly string[];
	messages: readonly string[];
	sendAt?: number;
	signal?: AbortSignal;
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

export type SmsIrPackQuery = Readonly<{
	pageNumber?: number;
	pageSize?: number;
	signal?: AbortSignal;
}>;

export type SmsIrPackSummary = Readonly<{
	packId: string;
	recipientCount: number;
	createdAt: number;
}>;

export type SmsIrPackMessage = SmsIrMessageStatus;
