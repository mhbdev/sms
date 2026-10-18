import type {
	SmsBatchMessage,
	SmsBulkMessage,
	SmsBulkSendResult,
	SmsMessage,
	SmsSendResult,
	SmsTemplateMessage,
} from "./sms.js";
import type { SmsIrLikeToLikeMessage } from "./sms-ir.js";

export type SmsPoolOperation =
	| "sendMessage"
	| "sendTemplate"
	| "sendBulk"
	| "sendArray"
	| "sendLikeToLike";

/** Adapters accept pool-neutral messages and translate to provider-specific inputs. */
export type SmsProviderPoolEntry = Readonly<{
	name: string;
	/** Smaller values are preferred by priority routing. */
	priority?: number;
	/** Positive integer used by weighted round robin. */
	weight?: number;
	sendMessage?: (message: SmsMessage) => Promise<SmsSendResult>;
	sendTemplate?: (message: SmsTemplateMessage) => Promise<SmsSendResult>;
	sendBulk?: (message: SmsBulkMessage) => Promise<SmsBulkSendResult>;
	/** Typed adapter for a provider's per-recipient batch operation. */
	sendArray?: (
		messages: readonly SmsBatchMessage[],
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<readonly SmsSendResult[]>;
	/** Typed adapter for a provider's per-recipient-message batch operation. */
	sendLikeToLike?: (message: SmsIrLikeToLikeMessage) => Promise<SmsBulkSendResult>;
}>;

export type SmsPoolFailureClassification = Readonly<{
	outcome: "rejected" | "unknown";
	retryable: boolean;
	retryAfterMs?: number;
	code?: string;
	httpStatus?: number;
	providerStatus?: number | string;
}>;

export type SmsPoolAttempt = Readonly<{
	provider: string;
	operation: SmsPoolOperation;
	outcome: "accepted" | "rejected" | "unknown";
	code?: string;
	httpStatus?: number;
	providerStatus?: number | string;
	retryable?: boolean;
}>;

export type SmsPoolEvent =
	| Readonly<{
			type: "provider-selected";
			provider: string;
			operation: SmsPoolOperation;
			attempt: number;
	  }>
	| Readonly<{
			type: "attempt-succeeded";
			provider: string;
			operation: SmsPoolOperation;
			attempt: number;
	  }>
	| Readonly<{
			type: "attempt-failed";
			provider: string;
			operation: SmsPoolOperation;
			attempt: number;
			outcome: "rejected" | "unknown";
			retryable: boolean;
	  }>
	| Readonly<{
			type: "circuit-state-changed";
			provider: string;
			state: SmsProviderCircuitState;
	  }>;

export type SmsProviderCircuitState = "closed" | "open" | "half-open";

export type SmsRoutingContext = Readonly<{
	operation: SmsPoolOperation;
	providers: readonly SmsProviderPoolEntry[];
}>;

export interface SmsRoutingStrategy {
	order(context: SmsRoutingContext): readonly string[];
}

export interface SmsProviderHealth {
	getState(provider: string): SmsProviderCircuitState;
	/** Acquires a normal slot or the single half-open probe slot. */
	acquire(provider: string): boolean;
	/** Releases an acquired half-open probe when no provider request was made. */
	release(provider: string): void;
	recordSuccess(provider: string): void;
	recordFailure(provider: string): void;
}

export type SmsProviderPoolOptions = Readonly<{
	providers: readonly SmsProviderPoolEntry[];
	strategy?: SmsRoutingStrategy;
	health?: SmsProviderHealth;
	circuitBreaker?: Readonly<{
		failureThreshold?: number;
		cooldownMs?: number;
		now?: () => number;
	}>;
	maxAttemptsPerProvider?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	backoffMultiplier?: number;
	sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
	onEvent?: (event: SmsPoolEvent) => void;
	classifyError?: (
		error: unknown,
		provider: SmsProviderPoolEntry,
		operation: SmsPoolOperation,
	) => SmsPoolFailureClassification;
}>;

export type SmsPoolBatchInput = readonly SmsBatchMessage[];
export type SmsPoolBatchResult = readonly SmsSendResult[];
export type SmsPoolLikeToLikeInput = SmsIrLikeToLikeMessage;
