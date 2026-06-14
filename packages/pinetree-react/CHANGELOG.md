# Changelog

All notable changes to `@pinetreepayments/react` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-13

Initial private beta release.

### Added

- `PineTreeProvider` — React context provider; accepts `publicKey` (`pk_live_*`)
  and optional `baseUrl` for local-development overrides
- `usePineTree()` — hook that returns the `@pinetreepayments/js` client instance;
  must be called below `PineTreeProvider`
- `PineTreeCheckoutButton` — button component that disables itself while
  checkout is opening and wires all browser SDK lifecycle events to typed
  callbacks: `onComplete`, `onFailed`, `onExpired`, `onCanceled`, `onError`,
  `onClosed`; all checkout options (`amount`, `currency`, `mode`,
  `reference`, `customer`, `metadata`, `successUrl`, `cancelUrl`) are
  forwarded to `@pinetreepayments/js`
- `PineTreeCheckout` — embedded iframe component that mounts a
  `mode: "embedded"` checkout; destroys the browser SDK instance and removes
  the iframe when the component unmounts
- Peer dependency on React 18+ and react-dom 18+
- Depends on `@pinetreepayments/js` with a published semver range
- ESM (`dist/esm/`) + CommonJS (`dist/cjs/`) dual-format build with full
  TypeScript declarations
