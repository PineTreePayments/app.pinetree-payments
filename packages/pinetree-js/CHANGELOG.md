# Changelog

All notable changes to `@pinetreepayments/js` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 14

### Added

- Versioned lifecycle events emitted from the hosted checkout page via
  `postMessage`: `complete`, `failed`, `expired`, `canceled`, `closed`
- `CheckoutEventPayload` type for the raw message shape
- `checkout.off(event, handler)` to remove individual event listeners
- `checkout.destroy()` to remove all listeners and dispose SDK-created iframe
  or popup resources; developer-owned container element is left intact
- Origin, source-window, session-ID, version, and event-name filtering so
  untrusted messages are silently ignored

## [0.3.0] — 2026-06-13

Phase 13: Checkout modes and event foundation.

### Added

- `checkout.open()` now accepts `mode: "redirect" | "popup" | "embedded"`
  (default `"redirect"`)
- **Popup mode** — reserves a centered `window.open()` popup during user
  activation, then navigates it to the checkout URL; throws
  `CheckoutInitializationError` with `code: "popup_blocked"` if the browser
  blocks the popup
- **Embedded mode** — creates an `<iframe>` inside `options.container` (CSS
  selector or `HTMLElement`); throws `CheckoutInitializationError` on
  missing or invalid container
- `checkout.open()` returns `CheckoutOpenResult` (extends
  `CheckoutSessionResult`) with `iframe?`, `popup?`, and `on()` for
  lifecycle event subscription
- New types: `CheckoutMode`, `CheckoutEventName`, `CheckoutEvent`,
  `CheckoutEventHandler`, `CheckoutOpenResult`

## [0.2.0] — 2026-06-13

Phase 12: Public-key checkout implementation.

### Added

- `checkout.open()` creates a checkout session via
  `POST /api/v1/browser/checkout/sessions`
- Redirects to `checkoutUrl` by default; pass `redirect: false` to suppress
- `CheckoutSessionResult` now includes `checkoutUrl` and `status: string`
- `CheckoutOptions` gains `redirect?: boolean` (deprecated in favor of `mode`)
- `CheckoutInitializationError` thrown on 401 (invalid or missing public key)
- `CheckoutSessionError` thrown on other API errors and network failures

## [0.1.0] — 2026-06-12

Initial preview release.

### Added

- `PineTree` browser client constructor — accepts a `pk_live_*` public key
  string or an options object (`publicKey`, `baseUrl`)
- `checkout.open()` interface defined — not yet implemented
- Error classes: `PineTreeBrowserError`, `CheckoutInitializationError`,
  `CheckoutSessionError`
- ESM (`dist/esm/`) + CommonJS (`dist/cjs/`) dual-format build
- Browser-safe: no Node.js built-ins; compatible with any modern bundler
