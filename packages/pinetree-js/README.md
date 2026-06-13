# @pinetree/js

Official PineTree browser JavaScript SDK.

> **Private Beta — not yet published to npm.** Reference this package via a
> local path or monorepo workspace while in private beta. When published, the
> install command will be `npm install @pinetree/js`.
>
> `@pinetree/js` creates checkout sessions from browser code using a public
> key (`pk_live_*`) and opens the PineTree hosted checkout page using
> redirect, popup, or embedded iframe modes.

---

## Installation

### Private beta (local path)

```bash
# package.json
"dependencies": {
  "@pinetree/js": "file:../../packages/pinetree-js"
}
```

### When published (future)

```bash
npm install @pinetree/js
```

### Script tag (future)

```html
<script src="https://js.pinetree-payments.com/v1"></script>
```

---

## Quick start

```javascript
import PineTree from "@pinetree/js"

const pinetree = new PineTree(process.env.NEXT_PUBLIC_PINETREE_PUBLIC_KEY)

// Redirect mode (default) — navigates to the PineTree hosted checkout:
await pinetree.checkout.open({
  amount: 2500,
  currency: "USD",
  reference: "order_abc123",
})
```

---

## Checkout modes

Redirect, popup, and embedded iframe modes are all **Preview**.

### Redirect (default)

```javascript
await pinetree.checkout.open({
  amount: 2500,
  mode: "redirect",   // default — omit for the same behavior
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
})
```

### Popup

```javascript
const result = await pinetree.checkout.open({
  amount: 2500,
  mode: "popup",
})
// result.popup — the Window reference
result.on("complete", ({ status }) => console.log("Checkout status:", status))
```

Throws `CheckoutInitializationError` (code: `"popup_blocked"`) if the browser
blocks the popup.

### Embedded iframe

```javascript
const result = await pinetree.checkout.open({
  amount: 2500,
  mode: "embedded",
  container: "#checkout-container",  // CSS selector or HTMLElement
})
// result.iframe — the <iframe> element
result.on("complete", ({ status }) => console.log("Checkout status:", status))
```

Throws `CheckoutInitializationError` if `container` is missing, not found in
the DOM, or does not support `appendChild`.

---

## Lifecycle Events (Preview)

All modes return a `CheckoutOpenResult` with `.on()`, `.off()`, and
`.destroy()`:

```typescript
result.on(event: CheckoutEventName, handler: (event: CheckoutEvent) => void): void
result.off(event: CheckoutEventName, handler: (event: CheckoutEvent) => void): void
result.destroy(): void
```

**Supported events:** `"complete"`, `"failed"`, `"expired"`, `"canceled"`, `"closed"`

```javascript
result.on("complete", (event) => {
  console.log(event.event)      // "complete"
  console.log(event.status)     // "paid"
  console.log(event.sessionId)  // session ID
  console.log(event.version)    // 1
})
result.on("failed", (event) => { /* ... */ })
result.on("closed", (event) => { /* ... */ })
```

Hosted checkout now emits versioned browser-safe postMessage payloads. Messages
are filtered to the hosted checkout origin, matching popup/iframe window,
matching session, supported version, and supported event.

Use `off()` to remove one handler. Use `destroy()` to remove listeners and
dispose of the SDK-created iframe or popup. The developer-owned container is
left intact.

---

## API key format

The browser SDK uses a **public key** — safe to include in client-side code
and `NEXT_PUBLIC_` environment variables. Never use server-side `pt_live_*`
API keys in the browser.

```
pk_live_<key>
```

Create a public key in the merchant dashboard under **Developer → Public Keys**.

---

## Constructor

```typescript
// String shorthand
const pinetree = new PineTree("pk_live_...")

// Options object
const pinetree = new PineTree({
  publicKey: "pk_live_...",
  baseUrl: "http://localhost:3000",  // override for local development
})
```

---

## `CheckoutOptions`

| Field | Type | Description |
|---|---|---|
| `amount` | `number` | **Required.** Amount in smallest currency unit (cents for USD) |
| `currency` | `string` | ISO-4217 code, uppercase. Defaults to `"USD"` |
| `reference` | `string` | Your internal order ID |
| `customer.email` | `string` | Customer email address |
| `metadata` | `object` | Arbitrary key/value pairs |
| `successUrl` | `string` | Redirect URL after successful payment |
| `cancelUrl` | `string` | Redirect URL after cancellation |
| `mode` | `CheckoutMode` | `"redirect"` \| `"popup"` \| `"embedded"`. Default `"redirect"` |
| `container` | `string \| HTMLElement` | Target for embedded mode — CSS selector or DOM element |
| `redirect` | `boolean` | Deprecated — use `mode` instead |

---

## Error classes

```typescript
import {
  PineTreeBrowserError,
  CheckoutInitializationError,
  CheckoutSessionError,
} from "@pinetree/js"
```

| Class | Trigger |
|---|---|
| `PineTreeBrowserError` | Base class for all browser SDK errors |
| `CheckoutInitializationError` | Invalid/missing public key (401), popup blocked, missing/invalid container, or constructor misconfiguration |
| `CheckoutSessionError` | Session creation failed (400/422/500) or network error |

All errors expose:
- `message` — human-readable description
- `code` — machine-readable error code
- `type` — error type category

---

## TypeScript types

```typescript
import type {
  PineTreeJSOptions,
  CheckoutOptions,
  CheckoutMode,
  CheckoutEventName,
  CheckoutEventPayload,
  CheckoutEvent,
  CheckoutEventHandler,
  CheckoutOpenResult,
  CheckoutSessionResult,
  CheckoutError,
} from "@pinetree/js"
```

---

## Module formats

| Format | Entry point |
|---|---|
| ESM | `dist/esm/index.js` |
| CommonJS | `dist/cjs/index.js` |
| Types | `dist/types/index.d.ts` |
| Browser (bundler) | `dist/esm/index.js` (`browser` field) |

---

## Development

```bash
# Build
node packages/pinetree-js/scripts/build.mjs

# Type-check
npx tsc -p packages/pinetree-js/tsconfig.json --noEmit

# Tests
cd packages/pinetree-js && npx vitest run
```

---

## Changelog

### Unreleased (Phase 14)

- Hosted checkout now emits versioned lifecycle events for complete, failed,
  expired, canceled, and closed states
- Added `CheckoutEventPayload`
- Added `checkout.off()` and `checkout.destroy()`
- `destroy()` removes message listeners and disposes SDK-owned iframe or popup
  resources
- Invalid origins, sources, sessions, versions, and event names are ignored

### 0.3.0 (2026-06-13)

Phase 13: Checkout modes and event foundation.

- `checkout.open()` now supports `mode: "redirect" | "popup" | "embedded"`
- Popup mode: reserves a centered `window.open()` popup during user activation, then navigates it to checkout; throws `CheckoutInitializationError` (`code: "popup_blocked"`) if blocked
- Embedded mode: creates an `<iframe>` inside `options.container`; throws `CheckoutInitializationError` on missing/invalid container
- `checkout.open()` returns `CheckoutOpenResult` (extends `CheckoutSessionResult`) with `iframe?`, `popup?`, and `on()`
- Event foundation introduced for `.on("complete" | "failed" | "expired" | "canceled" | "closed", handler)`
- New types: `CheckoutMode`, `CheckoutEventName`, `CheckoutEvent`, `CheckoutEventHandler`, `CheckoutOpenResult`

### 0.2.0 (2026-06-13)

Phase 12: Public-key checkout implementation.

- `checkout.open()` now creates a session via `POST /api/v1/browser/checkout/sessions`
- Redirects to `checkoutUrl` by default; pass `redirect: false` to suppress
- `CheckoutSessionResult` now includes `checkoutUrl` and `status: string`
- `CheckoutOptions` gains `redirect?: boolean`
- `CheckoutInitializationError` thrown on 401 (invalid/missing public key)
- `CheckoutSessionError` thrown on other API errors and network failures

### 0.1.0 (2026-06-12)

Initial preview release.

- `PineTree` browser client constructor (string or options object)
- `checkout.open()` interface defined — not yet implemented
- Error classes: `PineTreeBrowserError`, `CheckoutInitializationError`, `CheckoutSessionError`
- ESM + CJS + TypeScript declarations
- Browser-safe: no Node.js built-ins
