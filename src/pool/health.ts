import type { SmsProviderCircuitState, SmsProviderHealth } from "../contracts/pool.js";

export type InMemoryCircuitBreakerOptions = Readonly<{
	failureThreshold?: number;
	cooldownMs?: number;
	now?: () => number;
}>;

type Circuit = { failures: number; openUntil: number; probeInFlight: boolean };

export class InMemoryCircuitBreaker implements SmsProviderHealth {
	private readonly circuits = new Map<string, Circuit>();
	private readonly failureThreshold: number;
	private readonly cooldownMs: number;
	private readonly now: () => number;

	constructor(options: InMemoryCircuitBreakerOptions = {}) {
		this.failureThreshold = options.failureThreshold ?? 3;
		this.cooldownMs = options.cooldownMs ?? 30_000;
		this.now = options.now ?? Date.now;
		if (!Number.isSafeInteger(this.failureThreshold) || this.failureThreshold < 1)
			throw new TypeError("Circuit failureThreshold must be a positive integer");
		if (!Number.isFinite(this.cooldownMs) || this.cooldownMs < 0)
			throw new TypeError("Circuit cooldownMs must be a non-negative number");
	}

	getState(provider: string): SmsProviderCircuitState {
		const circuit = this.get(provider);
		if (circuit.openUntil === 0) return "closed";
		if (this.now() < circuit.openUntil) return "open";
		return "half-open";
	}

	acquire(provider: string): boolean {
		const circuit = this.get(provider);
		if (circuit.openUntil === 0) return true;
		if (this.now() < circuit.openUntil || circuit.probeInFlight) return false;
		circuit.probeInFlight = true;
		return true;
	}

	release(provider: string): void {
		this.get(provider).probeInFlight = false;
	}

	recordSuccess(provider: string): void {
		const circuit = this.get(provider);
		circuit.failures = 0;
		circuit.openUntil = 0;
		circuit.probeInFlight = false;
	}

	recordFailure(provider: string): void {
		const circuit = this.get(provider);
		circuit.probeInFlight = false;
		circuit.failures += 1;
		if (circuit.failures >= this.failureThreshold) {
			circuit.openUntil = this.now() + this.cooldownMs;
		}
	}

	private get(provider: string): Circuit {
		let circuit = this.circuits.get(provider);
		if (!circuit) {
			circuit = { failures: 0, openUntil: 0, probeInFlight: false };
			this.circuits.set(provider, circuit);
		}
		return circuit;
	}
}
