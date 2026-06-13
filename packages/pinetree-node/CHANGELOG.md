# Changelog

All notable changes to `@pinetree/node` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-12

Initial private beta release.

### Added

- `PineTree` client constructor — accepts a `pt_live_*` API key string or an
  options object (`apiKey`, `baseUrl`, `timeout`)
- **Checkout sessions** — `create`, `retrieve`, `list`, `cancel`, `expire`
  - `create` supports idempotency via `Idempotency-Key` request header
  - `list` supports cursor-based pagination and date-range filters
- **Payments** — `retrieve`
- **Webhook deliveries** — `list`, `retry`
- **Webhook verification** — `constructEvent` with HMAC-SHA256
  - Header-object overload (verifies `PineTree-Event-Id` and webhook version)
  - Individual-values overload for custom header extraction
  - Configurable replay window (default 300 s)
- Full TypeScript declarations for all types and parameters
- ESM (`dist/esm/`) + CommonJS (`dist/cjs/`) dual-format build
- Node.js 18+ support
