# `@mhbdev/sms`

Provider-neutral SMS delivery clients for Node.js 20+ and Bun, with first-class
adapters for [Kavenegar](https://kavenegar.com/rest.html) and
[SMS.ir](https://sms.ir/rest-api/).

The package uses the platform `fetch` API and Zod for strict runtime validation of
configuration, requests, and provider responses. It supports injected transports for
deterministic tests and never retries paid messages unless you explicitly configure a
retry policy.

## Install

```sh
npm install @mhbdev/sms
```

## Kavenegar

```ts
import { KavenegarSmsProvider } from "@mhbdev/sms/kavenegar";

const sms = new KavenegarSmsProvider({
  apiKey: process.env.KAVENEGAR_API_KEY!,
  sender: "90005738",
});

await sms.sendMessage({
  recipient: "+989121234567",
  message: "Your order is ready.",
});

await sms.sendTemplate({
  recipient: "+989121234567",
  template: "my-otp-pattern",
  parameters: ["123456"],
});
```

For Kavenegar raw, bulk, and send-array requests, `sender` in the provider
options is the default sender number. A message-level `sender` overrides it:

```ts
await sms.sendMessage({
  recipient: "+989121234567",
  message: "Sent from a specific line.",
  sender: "10004346",
});
```

Kavenegar's pattern/`VerifyLookup` API does not accept a sender number in its
request; Kavenegar selects the sender associated with the pattern. The sender
returned by Kavenegar is preserved in the normalized result when provided.

## SMS.ir

```ts
import { SmsIrProvider } from "@mhbdev/sms/sms-ir";

const sms = new SmsIrProvider({
  apiKey: process.env.SMS_IR_API_KEY!,
  lineNumber: "300000000000",
});

await sms.sendMessage({
  recipient: "09121234567",
  message: "Your order is ready.",
});

await sms.sendTemplate({
  recipient: "09121234567",
  templateId: 123456,
  parameters: [{ name: "CODE", value: "123456" }],
});
```

SMS.ir raw and bulk contracts intentionally do not expose `sender`, `localId`,
or `tag`; SMS.ir uses the configured `lineNumber` and rejects unsupported fields
at runtime instead of silently ignoring them.

## Capability surface

Both adapters expose raw sending, provider-specific template sending, and the
provider's delivery/reporting operations. Kavenegar additionally exposes
send-array, scheduled-message cancellation, status-by-local-id, inbox, and
inbox-count operations. SMS.ir additionally exposes like-to-like delivery,
scheduled-pack cancellation, message status, and pack reports.

The capability contracts are generic so provider-specific request and result
types remain precise. Use `SmsMessageScheduler` for message-ID cancellation and
`SmsPackScheduler` for providers that cancel a provider-managed scheduled pack.

Use provider-specific types when a capability is not shared by both services. The
root import keeps the existing `@dordoone/sms` contract names available for
migrations:

```ts
import type { SmsMessageSender, SmsTemplateSender } from "@mhbdev/sms";
```

## Timeouts, aborts, and retries

Every provider accepts `timeoutMs`, an injected `fetcher`, a custom `baseUrl`,
additional headers, and an optional retry policy. Retries are disabled by default
because retrying after an unknown provider response can duplicate a paid SMS.

```ts
const sms = new SmsIrProvider({
  apiKey: process.env.SMS_IR_API_KEY!,
  lineNumber: "300000000000",
  retry: {
    maxAttempts: 3,
    initialDelayMs: 250,
    maxDelayMs: 2_000,
  },
});
```

Provider failures are represented by `KavenegarError` or `SmsIrError`. Errors
retain their original `cause`, stable error codes, provider status, HTTP status,
and retry metadata without including API keys in messages.

Provider-level HTTP retries continue to apply to read operations. Send operations
are issued once per provider attempt; the pool only retries or fails over when a
provider explicitly reports that it rejected the send and marks that rejection
retryable. Timeouts, connection loss, and server errors with an uncertain result
produce an `SmsProviderPoolError` with `outcome: "unknown"` and stop routing.

## Provider pools

`SmsProviderPool` combines provider adapters for raw, template, bulk, and native
batch sends. Adapters receive pool-neutral messages and can translate them to a
provider's own template or batch contract. A provider without an adapter for an
operation is skipped.

```ts
import {
  PriorityRoutingStrategy,
  SmsProviderPool,
  WeightedRoundRobinStrategy,
} from "@mhbdev/sms";
import { KavenegarSmsProvider } from "@mhbdev/sms/kavenegar";
import { SmsIrProvider } from "@mhbdev/sms/sms-ir";

const kavenegar = new KavenegarSmsProvider({
  apiKey: process.env.KAVENEGAR_API_KEY!,
  sender: "90005738",
});
const smsIr = new SmsIrProvider({
  apiKey: process.env.SMS_IR_API_KEY!,
  lineNumber: "300000000000",
});

const pool = new SmsProviderPool({
  strategy: new PriorityRoutingStrategy(), // Or new WeightedRoundRobinStrategy()
  providers: [
    {
      name: "kavenegar",
      priority: 1,
      sendMessage: (message) => kavenegar.sendMessage(message),
      sendTemplate: (message) => kavenegar.sendTemplate(message),
      sendBulk: (message) => kavenegar.sendBulk(message),
    },
    {
      name: "sms.ir",
      priority: 2,
      weight: 2,
      sendMessage: (message) => smsIr.sendMessage({
        recipient: message.recipient,
        message: message.message,
        sendAt: message.sendAt,
        signal: message.signal,
      }),
      // Map portable template fields to SMS.ir's templateId and named parameters here.
    },
  ],
  circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000 },
});

await pool.sendMessage({ recipient: "09121234567", message: "Your order is ready." });
```

Priority routing tries providers in ascending `priority` order (default `0`).
Weighted round robin uses each provider's positive integer `weight` (default
`1`) and keeps state per strategy instance. Both strategies return remaining
eligible providers as failover candidates. Implement `SmsRoutingStrategy` to
provide a custom ordering, or `SmsProviderHealth` to use external health state.
For application adapters, set `deliveryOutcome: "rejected"` and
`retryable: true` on a `SmsProviderError` only when the provider confirms the
request was not accepted. Alternatively, use `classifyError` to map a provider's
documented error responses to that classification; all unclassified errors stop
with an unknown outcome.

The default in-memory circuit breaker opens after three health failures for 30
seconds, then permits one half-open probe. Set `circuitBreaker` to change those
defaults or pass a custom `health` implementation. Health state is local to the
pool instance. Optional `onEvent` reports selection, attempt, and circuit-state
changes; observer exceptions do not affect delivery.

Template adapters must map the template identifier and parameters explicitly.
Batch adapters are operation specific (`sendArray` versus `sendLikeToLike`) and
are never inferred.

The pool defaults to one attempt per provider. `maxAttemptsPerProvider` and the
backoff options enable retry after definitely rejected, retryable sends. They do
not enable retry after unknown outcomes. This is a deliberate safety change from
the legacy provider `retry` option: configured transport retries no longer replay
send requests, while reads retain their existing retry behavior.

## Development

```sh
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run pack:check
```

Live provider tests are intentionally not part of the default suite. Use mocked
fetchers for normal tests and run live tests only from a protected environment with
dedicated provider credentials.

## Migration from `@dordoone/sms`

The existing raw/template contracts and Kavenegar exports are preserved. Replace
the package name, then move provider-specific imports to `@mhbdev/sms/kavenegar`
when you want the explicit subpath form. The provider-neutral interfaces can be
used unchanged.

## License

MIT © 2026 mhbdev
