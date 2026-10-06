import type { RetryPolicy } from "../transport/http";

export type SmsHttpFetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type SmsHttpOptions = Readonly<{
	timeoutMs?: number;
	fetcher?: SmsHttpFetcher;
	baseUrl?: string;
	defaultHeaders?: Readonly<Record<string, string>>;
	retry?: RetryPolicy;
}>;
