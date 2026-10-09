import type { SmsHttpOptions } from "./http.js";
import type {
	SmsBatchMessage,
	SmsBulkMessage,
	SmsBulkSendResult,
	SmsCancellationResult,
	SmsDeliveryStatus,
	SmsDeliveryStatusQuery,
	SmsReceivedMessage,
	SmsSendResult,
	SmsTemplateMessage,
} from "./sms.js";

export type KavenegarSmsProviderOptions = Readonly<
	SmsHttpOptions & {
		apiKey: string;
		/** Default sender number for raw, bulk, and send-array requests. */
		sender?: string;
	}
>;

export type KavenegarSendResult = SmsSendResult &
	Readonly<{
		provider: "kavenegar";
		recipient?: string;
		sender?: string;
		statusText?: string;
		date?: number;
		cost?: number;
		message?: string;
	}>;

export type KavenegarSendArrayMessage = Omit<
	SmsBatchMessage,
	"sendAt" | "localId" | "signal"
>;

export type KavenegarStatusResult = SmsDeliveryStatus & Readonly<{ localId?: string }>;

export type KavenegarBulkRequest = SmsBulkMessage;
export type KavenegarBulkResult = SmsBulkSendResult;
export type KavenegarCancellationResult = SmsCancellationResult;
export type KavenegarReceivedMessage = SmsReceivedMessage;

export type KavenegarStatusQuery = SmsDeliveryStatusQuery;

export type KavenegarReceiveQuery = Readonly<{
	lineNumber: string;
	isRead: boolean;
	signal?: AbortSignal;
}>;

export type KavenegarCountQuery = Readonly<{
	startDate: number;
	endDate?: number;
	lineNumber?: string;
	isRead?: boolean;
	signal?: AbortSignal;
}>;

export type KavenegarCountResult = Readonly<{
	startDate: number;
	endDate: number;
	count: number;
}>;

export type KavenegarOutboxCountQuery = Readonly<{
	startDate: number;
	endDate?: number;
	status?: number;
	signal?: AbortSignal;
}>;

export type KavenegarSearchQuery = Readonly<{
	messageIds?: readonly (string | number)[];
	startDate: number;
	endDate?: number;
	lineNumber?: string;
	page?: number;
	pageSize?: number;
	signal?: AbortSignal;
}>;

export type KavenegarTemplateMessage = SmsTemplateMessage;
