import { z } from "zod";

import type { SmsHttpFetcher } from "../contracts/http.js";
import type { RetryPolicy } from "../transport/http.js";

/** A string that cannot be blank, while preserving the caller's original value. */
export const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0);

export const finiteNumberSchema = z.number().finite();
export const nonNegativeIntegerSchema = z.number().int().nonnegative();
export const positiveIntegerSchema = z
	.number()
	.int()
	.positive({ message: "must be a positive integer" });
export const localIdSchema = z.union([nonBlankStringSchema, finiteNumberSchema]);
export const sendAtSchema = z
	.union([nonNegativeIntegerSchema, z.date().refine((value) => value.getTime() >= 0)])
	.transform((value) =>
		value instanceof Date ? Math.floor(value.getTime() / 1_000) : value,
	);

export const abortSignalSchema = z.custom<AbortSignal>(
	(value) =>
		typeof value === "object" &&
		value !== null &&
		typeof (value as { aborted?: unknown }).aborted === "boolean" &&
		typeof (value as { addEventListener?: unknown }).addEventListener === "function" &&
		typeof (value as { removeEventListener?: unknown }).removeEventListener ===
			"function",
);

const functionSchema = z.custom<(...args: never[]) => unknown>(
	(value) => typeof value === "function",
);

const retryPolicySchema = z
	.object({
		maxAttempts: positiveIntegerSchema,
		initialDelayMs: finiteNumberSchema.nonnegative().optional(),
		maxDelayMs: finiteNumberSchema.nonnegative().optional(),
		backoffMultiplier: finiteNumberSchema.min(1).optional(),
		retryOn: functionSchema.optional(),
		sleep: functionSchema.optional(),
	})
	.strict()
	.transform((value): RetryPolicy => value as RetryPolicy);

const transportOptionsSchema = z
	.object({
		timeoutMs: positiveIntegerSchema.optional(),
		fetcher: z.custom<SmsHttpFetcher>((value) => typeof value === "function").optional(),
		baseUrl: z
			.string()
			.url()
			.refine((value) => {
				const protocol = new URL(value).protocol;
				return protocol === "http:" || protocol === "https:";
			}, "baseUrl must use http or https")
			.optional(),
		defaultHeaders: z.record(z.string(), z.string()).optional(),
		retry: retryPolicySchema.optional(),
	})
	.partial()
	.strict();

export const kavenegarOptionsSchema = transportOptionsSchema.extend({
	apiKey: nonBlankStringSchema,
	sender: nonBlankStringSchema.optional(),
});

export const smsIrOptionsSchema = transportOptionsSchema.extend({
	apiKey: nonBlankStringSchema,
	lineNumber: z.union([nonBlankStringSchema, positiveIntegerSchema]),
});

export const smsMessageSchema = z
	.object({
		recipient: nonBlankStringSchema,
		message: nonBlankStringSchema,
		sender: nonBlankStringSchema.optional(),
		sendAt: sendAtSchema.optional(),
		localId: localIdSchema.optional(),
		tag: z.string().optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const smsBulkMessageSchema = z
	.object({
		recipients: z.array(nonBlankStringSchema).min(1).max(200),
		message: nonBlankStringSchema,
		sender: nonBlankStringSchema.optional(),
		sendAt: sendAtSchema.optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const smsIrMessageSchema = z
	.object({
		recipient: nonBlankStringSchema,
		message: nonBlankStringSchema,
		sendAt: sendAtSchema.optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const smsIrBulkMessageSchema = z
	.object({
		recipients: z.array(nonBlankStringSchema).min(1).max(100),
		message: nonBlankStringSchema,
		sendAt: sendAtSchema.optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const smsBatchMessageSchema = z
	.object({
		recipient: nonBlankStringSchema,
		message: nonBlankStringSchema,
		sender: nonBlankStringSchema.optional(),
		sendAt: sendAtSchema.optional(),
		localId: localIdSchema.optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const kavenegarSendArrayMessageSchema = z
	.object({
		recipient: nonBlankStringSchema,
		message: nonBlankStringSchema,
		sender: nonBlankStringSchema.optional(),
	})
	.strict();

export const signalOptionsSchema = z
	.object({ signal: abortSignalSchema.optional() })
	.strict();

export const idsInputSchema = z.array(localIdSchema).min(1);

export const cancellationInputSchema = z.object({ ids: idsInputSchema }).strict();

export const deliveryStatusQuerySchema = z
	.object({
		messageIds: idsInputSchema,
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const kavenegarTemplateSchema = z
	.object({
		recipient: nonBlankStringSchema,
		template: nonBlankStringSchema,
		parameters: z.array(z.string()).min(1).max(3),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const kavenegarReceiveQuerySchema = z
	.object({
		lineNumber: nonBlankStringSchema,
		isRead: z.boolean(),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const kavenegarCountQuerySchema = z
	.object({
		startDate: nonNegativeIntegerSchema,
		endDate: nonNegativeIntegerSchema.optional(),
		lineNumber: nonBlankStringSchema.optional(),
		isRead: z.boolean().optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict()
	.refine((value) => value.endDate === undefined || value.endDate >= value.startDate, {
		message: "endDate must be greater than or equal to startDate",
		path: ["endDate"],
	});

export const kavenegarSearchQuerySchema = z
	.object({
		messageIds: idsInputSchema.optional(),
		startDate: nonNegativeIntegerSchema,
		endDate: nonNegativeIntegerSchema.optional(),
		lineNumber: nonBlankStringSchema.optional(),
		page: positiveIntegerSchema.optional(),
		pageSize: positiveIntegerSchema.optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict()
	.refine((value) => value.endDate === undefined || value.endDate >= value.startDate, {
		message: "endDate must be greater than or equal to startDate",
		path: ["endDate"],
	});

export const kavenegarOutboxCountQuerySchema = z
	.object({
		startDate: nonNegativeIntegerSchema,
		endDate: nonNegativeIntegerSchema.optional(),
		status: nonNegativeIntegerSchema.optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict()
	.refine((value) => value.endDate === undefined || value.endDate >= value.startDate, {
		message: "endDate must be greater than or equal to startDate",
		path: ["endDate"],
	});

export const smsIrTemplateSchema = z
	.object({
		recipient: nonBlankStringSchema,
		templateId: positiveIntegerSchema,
		parameters: z.array(
			z.object({
				name: nonBlankStringSchema,
				value: z.string(),
			}),
		),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export const smsIrLikeToLikeSchema = z
	.object({
		recipients: z.array(nonBlankStringSchema).min(1).max(100),
		messages: z.array(nonBlankStringSchema).min(1).max(100),
		sendAt: sendAtSchema.optional(),
		signal: abortSignalSchema.optional(),
	})
	.refine((value) => value.recipients.length === value.messages.length, {
		message: "Recipients and messages must have equal lengths",
		path: ["messages"],
	})
	.strict();

export const packQuerySchema = z
	.object({
		pageNumber: positiveIntegerSchema.optional(),
		pageSize: positiveIntegerSchema.optional(),
		signal: abortSignalSchema.optional(),
	})
	.strict();

export function formatZodIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length === 0 ? "input" : issue.path.join(".");
			return `${path}: ${issue.message}`;
		})
		.join("; ");
}

export function parseInput<TSchema extends z.ZodType>(
	schema: TSchema,
	value: unknown,
	createError: (message: string, cause: z.ZodError) => Error,
): z.output<TSchema> {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw createError(`Invalid input: ${formatZodIssues(result.error)}`, result.error);
	}
	return result.data;
}
