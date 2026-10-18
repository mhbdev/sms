import type {
	SmsProviderPoolEntry,
	SmsRoutingContext,
	SmsRoutingStrategy,
} from "../contracts/pool.js";

export class PriorityRoutingStrategy implements SmsRoutingStrategy {
	order({ providers }: SmsRoutingContext): readonly string[] {
		return [...providers]
			.sort(
				(a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name),
			)
			.map((provider) => provider.name);
	}
}

/** Smooth weighted round robin. Each call starts with the next weighted provider. */
export class WeightedRoundRobinStrategy implements SmsRoutingStrategy {
	private readonly currentWeights = new Map<string, number>();

	order({ providers }: SmsRoutingContext): readonly string[] {
		if (providers.length === 0) return [];
		const totalWeight = providers.reduce(
			(total, provider) => total + getWeight(provider),
			0,
		);
		const current = providers.map((provider) => ({
			provider,
			current: (this.currentWeights.get(provider.name) ?? 0) + getWeight(provider),
		}));
		const selected = [...current].sort(
			(a, b) => b.current - a.current || a.provider.name.localeCompare(b.provider.name),
		)[0];
		if (!selected) return [];
		selected.current -= totalWeight;
		for (const item of current) this.currentWeights.set(item.provider.name, item.current);
		return [
			selected.provider.name,
			...current
				.filter((item) => item.provider.name !== selected.provider.name)
				.sort(
					(a, b) =>
						(a.provider.priority ?? 0) - (b.provider.priority ?? 0) ||
						b.current - a.current ||
						a.provider.name.localeCompare(b.provider.name),
				)
				.map((item) => item.provider.name),
		];
	}
}

function getWeight(provider: SmsProviderPoolEntry): number {
	return provider.weight ?? 1;
}
