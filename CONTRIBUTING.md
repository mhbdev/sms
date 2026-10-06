# Contributing

## Development requirements

- Node.js 20 or newer
- npm 11 or newer
- Bun is supported for local runtime compatibility checks

Install dependencies with `npm install`, then run `npm test`, `npm run typecheck`,
`npm run lint`, and `npm run build` before opening a pull request.

## Pull requests

Provider behavior changes must include deterministic tests using an injected fetcher.
Do not include API keys, real phone numbers, message content, or live provider
responses in commits. Public API changes require a changeset and documentation.

Keep provider-neutral contracts independent from provider-specific request formats.
Provider-specific behavior belongs under its adapter and must preserve the original
provider error as `cause` when wrapping failures.
