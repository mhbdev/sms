# `@mhbdev/sms`

Provider-neutral SMS delivery clients for Node.js 20+ and Bun, with first-class
adapters for [Kavenegar](https://kavenegar.com/rest.html) and
[SMS.ir](https://sms.ir/rest-api/).

The package uses the platform `fetch` API, has no runtime dependencies, supports
injected transports for deterministic tests, and never retries paid messages unless
you explicitly configure a retry policy.

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

## Capability surface

Both adapters expose raw sending, provider-specific template sending, and the
provider's delivery/reporting operations. Kavenegar additionally exposes
send-array, scheduled-message cancellation, status-by-local-id, inbox, and
inbox-count operations. SMS.ir additionally exposes like-to-like delivery,
scheduled-pack cancellation, message status, and pack reports.

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
