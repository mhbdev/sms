# Changelog

All notable changes to this project will be documented in this file.

## 0.2.2

### Patch Changes

- [`5f631f4`](https://github.com/mhbdev/sms/commit/5f631f4fe7cb8e0174b4bd2749d7b5afab4ed80c) Thanks [@mhbdev](https://github.com/mhbdev)! - Fix Kavenegar outbound reporting, harden transport cancellation and bounded retry behavior, enforce provider response cardinality, and strengthen runtime input validation.

## 0.2.1

### Patch Changes

- [`e1c3d90`](https://github.com/mhbdev/sms/commit/e1c3d905dd19bc0fb7836401cb0554664e785349) Thanks [@mhbdev](https://github.com/mhbdev)! - Modernize GitHub Actions security and CI dependencies while preserving Node 20 compatibility and the existing public API.

## 0.2.0

### Minor Changes

- [`7b80018`](https://github.com/mhbdev/sms/commit/7b80018a8531fee005d76545a077184e81a6d243) Thanks [@mhbdev](https://github.com/mhbdev)! - Add provider-specific capability contracts, scheduled-pack cancellation, typed sender support for Kavenegar, and runtime rejection of unsupported cross-provider fields.

### Patch Changes

- [`7b80018`](https://github.com/mhbdev/sms/commit/7b80018a8531fee005d76545a077184e81a6d243) Thanks [@mhbdev](https://github.com/mhbdev)! - Add strict Zod 4.6.5 validation for provider configuration, requests, and API responses.

## 0.1.0

- Initial standalone release with Kavenegar and SMS.ir adapters.
