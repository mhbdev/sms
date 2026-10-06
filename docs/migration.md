# Migration from `@dordoone/sms`

The standalone package preserves the original provider-neutral types and the
Kavenegar adapter shape.

## Package name

```sh
npm uninstall @dordoone/sms
npm install @mhbdev/sms
```

Replace imports from `@dordoone/sms` with `@mhbdev/sms`. Existing root exports
remain available, including:

- `SmsMessage`
- `SmsTemplateMessage`
- `SmsMessageSender`
- `SmsTemplateSender`
- `SmsSendResult`
- `KavenegarSmsProvider`
- `KavenegarError`
- `SmsProviderError`
- `parseKavenegarResponse`

Provider-specific imports can be made explicit:

```ts
import { KavenegarSmsProvider } from "@mhbdev/sms/kavenegar";
import { SmsIrProvider } from "@mhbdev/sms/sms-ir";
```

The Kavenegar client still converts Iranian `+98` recipients to the local
provider format, preserves injected fetchers, applies a 10-second default
timeout, and rejects malformed successful responses.

Kavenegar also supports a default `sender` option and per-message sender
overrides for raw, bulk, and send-array requests. SMS.ir uses `lineNumber`
instead; its raw and bulk inputs reject unsupported sender/local-id/tag fields.
