/** A provider-neutral raw SMS message. */
export type SmsMessage = Readonly<{
	recipient: string;
	message: string;
	/** Provider sender number override, when the provider supports sender selection. */
	sender?: string;
	sendAt?: number;
	localId?: string | number;
	tag?: string;
	signal?: AbortSignal;
}>;

/** A provider-neutral pattern/template message with ordered parameters. */
export type SmsTemplateMessage = Readonly<{
	recipient: string;
	template: string;
	parameters: readonly string[];
	signal?: AbortSignal;
}>;

/** One message per recipient, useful for provider batch APIs. */
export type SmsBatchMessage = Readonly<{
	recipient: string;
	message: string;
	/** Provider sender number override, when the provider supports sender selection. */
	sender?: string;
	sendAt?: number;
	localId?: string | number;
	signal?: AbortSignal;
}>;

/** A raw message addressed to one or more recipients. */
export type SmsBulkMessage = Readonly<{
	recipients: readonly string[];
	message: string;
	/** Sender number override for the whole bulk request, when supported. */
	sender?: string;
	sendAt?: number;
	signal?: AbortSignal;
}>;

/** Result status shared by all providers. */
export type SmsSendStatus = "accepted" | "scheduled" | "dry-run";

export type SmsSendResult = Readonly<{
	provider: string;
	messageId: string | null;
	status: SmsSendStatus;
	providerStatus?: string;
	providerMessage?: string;
	cost?: number;
	batchId?: string;
	recipient?: string;
}>;

export type SmsBulkSendResult = Readonly<{
	provider: string;
	batchId?: string;
	messages: readonly SmsSendResult[];
	cost?: number;
}>;

export type SmsDeliveryStatus = Readonly<{
	messageId: string;
	providerStatus: string;
	statusText?: string;
	deliveredAt?: number;
	recipient?: string;
}>;

export type SmsDeliveryStatusQuery = Readonly<{
	messageIds: readonly (string | number)[];
	signal?: AbortSignal;
}>;

export type SmsCancellationResult = Readonly<{
	provider: string;
	messageId?: string;
	batchId?: string;
	providerStatus?: string;
	statusText?: string;
	returnedCredit?: number;
}>;

export type SmsReceivedMessage = Readonly<{
	messageId: string;
	message: string;
	sender: string;
	recipient: string;
	date?: number;
}>;

export type SmsPage<T> = Readonly<{
	items: readonly T[];
	pageNumber?: number;
	pageSize?: number;
}>;

/** Capability for providers that send raw SMS messages. */
export interface SmsMessageSender {
	readonly name: string;
	sendMessage(message: SmsMessage): Promise<SmsSendResult>;
}

/** Capability for providers that send provider-managed template messages. */
export interface SmsTemplateSender<
	TMessage = SmsTemplateMessage,
	TResult extends SmsSendResult = SmsSendResult,
> {
	readonly name: string;
	sendTemplate(message: TMessage): Promise<TResult>;
}

/** Capability for providers that send one message to multiple recipients. */
export interface SmsBulkSender<
	TMessage = SmsBulkMessage,
	TResult extends SmsBulkSendResult = SmsBulkSendResult,
> {
	sendBulk(message: TMessage): Promise<TResult>;
}

/** Capability for providers that expose delivery status. */
export interface SmsDeliveryStatusReader<
	TQuery = SmsDeliveryStatusQuery,
	TResult = readonly SmsDeliveryStatus[],
> {
	getDeliveryStatus(query: TQuery): Promise<TResult>;
}

/** Capability for providers that can cancel scheduled messages or batches. */
export interface SmsScheduler<TCancellation = SmsCancellationResult> {
	cancelScheduled(
		input: Readonly<{ ids: readonly (string | number)[] }>,
	): Promise<readonly TCancellation[]>;
}

/** Capability for providers that expose inbound SMS messages. */
export interface SmsInboxReader<TQuery = unknown> {
	getReceivedMessages(query: TQuery): Promise<SmsPage<SmsReceivedMessage>>;
}
