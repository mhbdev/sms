import type {
	SmsPoolAttempt,
	SmsPoolEvent,
	SmsPoolFailureClassification,
	SmsPoolOperation,
	SmsProviderPoolEntry,
	SmsProviderPoolOptions,
	SmsRoutingContext,
} from "../contracts/pool.js";
import type {
	SmsBatchMessage,
	SmsBulkMessage,
	SmsBulkSender,
	SmsBulkSendResult,
	SmsMessage,
	SmsMessageSender,
	SmsSendResult,
	SmsTemplateMessage,
	SmsTemplateSender,
} from "../contracts/sms.js";
import type { SmsIrLikeToLikeMessage } from "../contracts/sms-ir.js";
import { SmsProviderError, SmsValidationError } from "../errors/sms-error.js";
import { InMemoryCircuitBreaker } from "./health.js";
import { PriorityRoutingStrategy } from "./strategies.js";

export class SmsProviderPoolError extends SmsProviderError {
	readonly operation: SmsPoolOperation;
	readonly outcome: "unknown" | "rejected" | "unavailable";
	readonly attempts: readonly SmsPoolAttempt[];

	constructor(
		message: string,
		options: Readonly<{
			operation: SmsPoolOperation;
			outcome: "unknown" | "rejected" | "unavailable";
			attempts: readonly SmsPoolAttempt[];
			retryable?: boolean;
			code?: string;
		}>,
	) {
		super(message, {
			code: options.code ?? "SMS_POOL_ERROR",
			retryable: options.retryable ?? false,
			deliveryOutcome:
				options.outcome === "unknown"
					? "unknown"
					: options.outcome === "rejected"
						? "rejected"
						: undefined,
		});
		this.name = "SmsProviderPoolError";
		this.operation = options.operation;
		this.outcome = options.outcome;
		this.attempts = Object.freeze([...options.attempts]);
	}
}

export class SmsProviderPool
	implements
		SmsMessageSender<SmsMessage>,
		SmsTemplateSender<SmsTemplateMessage>,
		SmsBulkSender<SmsBulkMessage>
{
	readonly name = "sms-pool";
	private readonly providers: readonly SmsProviderPoolEntry[];
	private readonly strategy: NonNullable<SmsProviderPoolOptions["strategy"]>;
	private readonly health: NonNullable<SmsProviderPoolOptions["health"]>;
	private readonly maxAttemptsPerProvider: number;
	private readonly initialDelayMs: number;
	private readonly maxDelayMs: number;
	private readonly backoffMultiplier: number;
	private readonly sleep: NonNullable<SmsProviderPoolOptions["sleep"]>;
	private readonly onEvent?: (event: SmsPoolEvent) => void;
	private readonly classifyError?: SmsProviderPoolOptions["classifyError"];
	private readonly observedCircuitStates = new Map<
		string,
		"closed" | "open" | "half-open"
	>();

	constructor(options: SmsProviderPoolOptions) {
		if (!options || !Array.isArray(options.providers) || options.providers.length === 0)
			throw new TypeError("SMS provider pool requires at least one provider");
		const names = new Set<string>();
		for (const provider of options.providers) {
			if (!provider.name.trim()) throw new TypeError("SMS provider name is required");
			if (names.has(provider.name))
				throw new TypeError(`Duplicate SMS provider name: ${provider.name}`);
			names.add(provider.name);
			if (
				!provider.sendMessage &&
				!provider.sendTemplate &&
				!provider.sendBulk &&
				!provider.sendArray &&
				!provider.sendLikeToLike
			)
				throw new TypeError(`SMS provider ${provider.name} has no send capabilities`);
			if (
				provider.weight !== undefined &&
				(!Number.isSafeInteger(provider.weight) || provider.weight <= 0)
			)
				throw new TypeError(
					`SMS provider ${provider.name} weight must be a positive integer`,
				);
			if (provider.priority !== undefined && !Number.isFinite(provider.priority))
				throw new TypeError(`SMS provider ${provider.name} priority must be finite`);
		}
		this.providers = [...options.providers];
		this.strategy = options.strategy ?? new PriorityRoutingStrategy();
		this.health = options.health ?? new InMemoryCircuitBreaker(options.circuitBreaker);
		this.maxAttemptsPerProvider = options.maxAttemptsPerProvider ?? 1;
		this.initialDelayMs = options.initialDelayMs ?? 100;
		this.maxDelayMs = options.maxDelayMs ?? 5_000;
		this.backoffMultiplier = options.backoffMultiplier ?? 2;
		this.sleep = options.sleep ?? defaultSleep;
		this.onEvent = options.onEvent;
		this.classifyError = options.classifyError;
		if (
			!Number.isSafeInteger(this.maxAttemptsPerProvider) ||
			this.maxAttemptsPerProvider < 1
		)
			throw new TypeError("maxAttemptsPerProvider must be a positive integer");
		if (
			!Number.isFinite(this.initialDelayMs) ||
			this.initialDelayMs < 0 ||
			!Number.isFinite(this.maxDelayMs) ||
			this.maxDelayMs < 0
		)
			throw new TypeError("SMS retry delays must be non-negative numbers");
		if (!Number.isFinite(this.backoffMultiplier) || this.backoffMultiplier < 1)
			throw new TypeError("backoffMultiplier must be at least one");
	}

	async sendMessage(message: SmsMessage): Promise<SmsSendResult> {
		return this.execute("sendMessage", message.signal, (provider) => {
			if (!provider.sendMessage) throw missingCapability("sendMessage");
			return provider.sendMessage(message);
		});
	}

	async sendTemplate(message: SmsTemplateMessage): Promise<SmsSendResult> {
		return this.execute("sendTemplate", message.signal, (provider) => {
			if (!provider.sendTemplate) throw missingCapability("sendTemplate");
			return provider.sendTemplate(message);
		});
	}

	async sendBulk(message: SmsBulkMessage): Promise<SmsBulkSendResult> {
		return this.execute("sendBulk", message.signal, (provider) => {
			if (!provider.sendBulk) throw missingCapability("sendBulk");
			return provider.sendBulk(message);
		});
	}

	async sendArray(
		messages: readonly SmsBatchMessage[],
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<readonly SmsSendResult[]> {
		return this.execute("sendArray", options.signal, (provider) => {
			if (!provider.sendArray) throw missingCapability("sendArray");
			return provider.sendArray(messages, options);
		});
	}

	async sendLikeToLike(message: SmsIrLikeToLikeMessage): Promise<SmsBulkSendResult> {
		return this.execute("sendLikeToLike", message.signal, (provider) => {
			if (!provider.sendLikeToLike) throw missingCapability("sendLikeToLike");
			return provider.sendLikeToLike(message);
		});
	}

	private async execute<TResult>(
		operation: SmsPoolOperation,
		signal: AbortSignal | undefined,
		invoke: (provider: SmsProviderPoolEntry) => Promise<TResult>,
	): Promise<TResult> {
		const eligible = this.providers.filter((provider) => {
			if (!hasCapability(provider, operation)) return false;
			return this.observeCircuitState(provider.name) !== "open";
		});
		const routingContext: SmsRoutingContext = { operation, providers: eligible };
		const orderedNames = this.strategy.order(routingContext);
		const ordered = resolveOrder(eligible, orderedNames);
		const attempts: SmsPoolAttempt[] = [];
		for (const provider of ordered) {
			if (signal?.aborted) throw this.abortError(operation, attempts);
			for (let attempt = 1; attempt <= this.maxAttemptsPerProvider; attempt += 1) {
				if (!this.health.acquire(provider.name)) break;
				this.observeCircuitState(provider.name);
				this.emit({
					type: "provider-selected",
					provider: provider.name,
					operation,
					attempt,
				});
				try {
					const result = await invoke(provider);
					this.updateHealth(provider.name, () =>
						this.health.recordSuccess(provider.name),
					);
					this.emit({
						type: "attempt-succeeded",
						provider: provider.name,
						operation,
						attempt,
					});
					return result;
				} catch (error) {
					if (error instanceof SmsValidationError) {
						this.updateHealth(provider.name, () => this.health.release(provider.name));
						throw error;
					}
					if (signal?.aborted) {
						attempts.push({
							provider: provider.name,
							operation,
							outcome: "unknown",
							retryable: false,
						});
						this.emit({
							type: "attempt-failed",
							provider: provider.name,
							operation,
							attempt,
							outcome: "unknown",
							retryable: false,
						});
						this.updateHealth(provider.name, () =>
							this.health.recordFailure(provider.name),
						);
						throw this.abortError(operation, attempts);
					}
					const classification = this.classify(error, provider, operation);
					const failure: SmsPoolAttempt = {
						provider: provider.name,
						operation,
						outcome: classification.outcome,
						...(classification.code ? { code: classification.code } : {}),
						...(classification.httpStatus === undefined
							? {}
							: { httpStatus: classification.httpStatus }),
						...(classification.providerStatus === undefined
							? {}
							: { providerStatus: classification.providerStatus }),
						retryable: classification.retryable,
					};
					attempts.push(failure);
					this.emit({
						type: "attempt-failed",
						provider: provider.name,
						operation,
						attempt,
						outcome: classification.outcome,
						retryable: classification.retryable,
					});
					if (classification.outcome === "unknown") {
						this.updateHealth(provider.name, () =>
							this.health.recordFailure(provider.name),
						);
						throw new SmsProviderPoolError(
							"SMS delivery outcome is unknown; no further provider was attempted",
							{
								operation,
								outcome: "unknown",
								attempts,
								code: "SMS_DELIVERY_OUTCOME_UNKNOWN",
							},
						);
					}
					if (!classification.retryable) {
						this.updateHealth(provider.name, () =>
							this.health.recordSuccess(provider.name),
						);
						throw new SmsProviderPoolError("SMS provider rejected the request", {
							operation,
							outcome: "rejected",
							attempts,
						});
					}
					this.updateHealth(provider.name, () =>
						this.health.recordFailure(provider.name),
					);
					if (attempt < this.maxAttemptsPerProvider) {
						try {
							await this.waitBeforeRetry(attempt, classification.retryAfterMs, signal);
						} catch {
							if (signal?.aborted) throw this.abortError(operation, attempts);
							throw new SmsProviderPoolError("SMS retry delay failed", {
								operation,
								outcome: "unknown",
								attempts,
								code: "SMS_POOL_RETRY_DELAY_FAILED",
							});
						}
						continue;
					}
					break;
				}
			}
		}
		if (signal?.aborted) throw this.abortError(operation, attempts);
		if (attempts.length === 0) {
			throw new SmsProviderPoolError("No healthy provider supports this SMS operation", {
				operation,
				outcome: "unavailable",
				attempts,
				code: "SMS_POOL_UNAVAILABLE",
			});
		}
		throw new SmsProviderPoolError("All eligible SMS providers rejected the request", {
			operation,
			outcome: "rejected",
			attempts,
			retryable: true,
			code: "SMS_POOL_EXHAUSTED",
		});
	}

	private classify(
		error: unknown,
		provider: SmsProviderPoolEntry,
		operation: SmsPoolOperation,
	): SmsPoolFailureClassification {
		if (this.classifyError) return this.classifyError(error, provider, operation);
		if (error instanceof SmsProviderError) {
			return {
				outcome: error.deliveryOutcome ?? "unknown",
				retryable: error.retryable === true && error.deliveryOutcome === "rejected",
				...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
				code: error.code,
				...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
				...(error.providerStatus === undefined
					? {}
					: { providerStatus: error.providerStatus }),
			};
		}
		return { outcome: "unknown", retryable: false };
	}

	private updateHealth(provider: string, update: () => void): void {
		update();
		this.observeCircuitState(provider);
	}

	private observeCircuitState(provider: string): "closed" | "open" | "half-open" {
		const state = this.health.getState(provider);
		const previous = this.observedCircuitStates.get(provider);
		this.observedCircuitStates.set(provider, state);
		if (previous !== undefined && previous !== state)
			this.emit({ type: "circuit-state-changed", provider, state });
		return state;
	}

	private emit(event: SmsPoolEvent): void {
		try {
			this.onEvent?.(event);
		} catch {
			/* Observability callbacks must not affect delivery. */
		}
	}

	private abortError(
		operation: SmsPoolOperation,
		attempts: readonly SmsPoolAttempt[],
	): SmsProviderPoolError {
		return new SmsProviderPoolError(
			"SMS pool operation was aborted; delivery outcome may be unknown",
			{
				operation,
				outcome: "unknown",
				attempts,
				code: "SMS_POOL_ABORTED",
			},
		);
	}

	private async waitBeforeRetry(
		attempt: number,
		retryAfterMs: number | undefined,
		signal?: AbortSignal,
	): Promise<void> {
		const backoff = Math.min(
			this.maxDelayMs,
			this.initialDelayMs * this.backoffMultiplier ** Math.max(0, attempt - 1),
		);
		const serverDelay =
			retryAfterMs !== undefined && Number.isFinite(retryAfterMs)
				? Math.max(0, retryAfterMs)
				: undefined;
		await this.sleep(Math.min(this.maxDelayMs, serverDelay ?? backoff), signal);
	}
}

function hasCapability(
	provider: SmsProviderPoolEntry,
	operation: SmsPoolOperation,
): boolean {
	switch (operation) {
		case "sendMessage":
			return provider.sendMessage !== undefined;
		case "sendTemplate":
			return provider.sendTemplate !== undefined;
		case "sendBulk":
			return provider.sendBulk !== undefined;
		case "sendArray":
			return provider.sendArray !== undefined;
		case "sendLikeToLike":
			return provider.sendLikeToLike !== undefined;
	}
}

function missingCapability(operation: SmsPoolOperation): SmsProviderPoolError {
	return new SmsProviderPoolError(`No adapter is registered for ${operation}`, {
		operation,
		outcome: "unavailable",
		attempts: [],
		code: "SMS_POOL_CAPABILITY_UNAVAILABLE",
	});
}

function resolveOrder(
	providers: readonly SmsProviderPoolEntry[],
	names: readonly string[],
): SmsProviderPoolEntry[] {
	const byName = new Map(providers.map((provider) => [provider.name, provider]));
	const ordered: SmsProviderPoolEntry[] = [];
	const seen = new Set<string>();
	for (const name of names) {
		const provider = byName.get(name);
		if (!provider)
			throw new TypeError(
				`Routing strategy returned an ineligible SMS provider: ${name}`,
			);
		if (!seen.has(name)) ordered.push(provider);
		seen.add(name);
	}
	for (const provider of providers) if (!seen.has(provider.name)) ordered.push(provider);
	return ordered;
}

async function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted)
		throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", abort);
			resolve();
		}, delayMs);
		const abort = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			reject(
				signal?.reason ?? new DOMException("The operation was aborted", "AbortError"),
			);
		};
		signal?.addEventListener("abort", abort, { once: true });
	});
}
