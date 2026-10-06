# Architecture

`@mhbdev/sms` is organized as a small provider-adapter library. The public
contracts describe capabilities without requiring callers to depend on a
provider's transport or response format.

## Layers

1. **Contracts** (`src/contracts`)

   Provider-neutral messages, results, capability interfaces, and provider
   configuration types live here. Provider-specific request fields remain in
   provider contracts so they can stay type-safe without weakening the shared
   interfaces.

2. **Transport** (`src/transport`)

   `SmsHttpTransport` owns injected `fetch`, timeout cancellation, default
   headers, abort propagation, and opt-in retry behavior. Providers pass it
   already validated requests and remain responsible for provider endpoint
   paths and body formats.

3. **Provider adapters** (`src/providers`)

   Provider classes validate inputs with Zod, build endpoint-specific requests,
   invoke the shared transport, and expose the provider capabilities. They do
   not expose API keys or provider response objects directly to callers.

4. **Response parsers** (`src/providers/*/*-api.ts`)

   Parsers validate successful and failed payloads with Zod, normalize provider
   fields into public results, and preserve provider status metadata. Malformed
   successful responses are treated as provider errors rather than silently
   returning partial data. Zod issues are retained as causes, while public error
   messages never include API keys or SMS content.

5. **Errors** (`src/errors`)

   Provider, validation, and transport errors share stable metadata such as
   error codes, causes, HTTP status, provider status, and retry information.

## Request lifecycle

```text
public capability method
        |
        v
provider validation + request construction
        |
        v
SmsHttpTransport (fetch, timeout, abort, optional retry)
        |
        v
provider response parser
        |
        v
normalized public result or typed provider error
```

Retries are disabled by default because a retried SMS request can create a
duplicate paid message. Applications must explicitly configure bounded retry
behavior and should use provider idempotency/local-ID features where available.

## Compatibility boundary

The root package and the `/kavenegar` and `/sms-ir` subpaths are public entry
points. Legacy names, including `SmsIrSmsProvider` and the Kavenegar parser and
error exports, are retained deliberately. Internal refactors must validate
these entrypoints with TypeScript import tests and package-tarball smoke tests.

Capability mismatches between providers are documented rather than hidden by
the shared interfaces. Redesigning those contracts is a separate migration
task and should not be bundled with structural refactors.
