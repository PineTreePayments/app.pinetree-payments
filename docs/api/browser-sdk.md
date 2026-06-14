# PineTree Browser JavaScript SDK

**Package:** `@pinetreepayments/js`
---

## Overview

The PineTree browser JavaScript SDK (`@pinetreepayments/js`) lets you create checkout
sessions directly from browser code using a **public key** — no server-side
proxy required.

`pinetree.checkout.open()` creates a session via a public-key-gated endpoint and
opens the PineTree hosted checkout using one of three modes:

- **`redirect`** (default) — replaces the current page with the hosted checkout
- **`popup`** — opens a centered popup window
- **`embedded`** — renders an iframe inside a container you provide

All modes return a `CheckoutOpenResult` with `.on()`, `.off()`, and `.destroy()`.
Lifecycle events are delivered by hosted checkout via versioned
`window.postMessage` payloads.

---

## Delivery methods

### Script tag (future)

```html
<script src="https://js.pinetree-payments.com/v1"></script>
<script>
  const pinetree = new PineTree("pk_live_...")
  await pinetree.checkout.open({ amount: 2500, currency: "USD" })
</script>
```

### npm

```bash
npm install @pinetreepayments/js
```

---

## API key

The browser SDK uses a **public key** — safe for browser code and client-side
environment variables. Never expose server-side `pt_live_*` API keys in the
browser.

```
pk_live_<key>
```

Public keys are provisioned from the merchant dashboard under
**Developer → Public Keys**, or via `POST /api/merchant/public-keys`.

---

## Constructor

```javascript
const pinetree = new PineTree(publicKey)

const pinetree = new PineTree({
  publicKey: "pk_live_...",
  baseUrl: "http://localhost:3000",  // for local development
})
```

Throws `CheckoutInitializationError` if `publicKey` is empty or missing.

---

## checkout.open()

```typescript
pinetree.checkout.open(options: CheckoutOptions): Promise<CheckoutOpenResult>
```

Creates a checkout session via the public-key-gated endpoint, then opens the
hosted checkout using the mode specified in `options.mode` (default `"redirect"`).

### Behavior

1. POSTs to `POST /api/v1/browser/checkout/sessions` with `X-PineTree-Public-Key` header.
2. Receives a session with a `checkoutUrl`.
3. Opens the checkout in the requested mode.
4. Resolves with `CheckoutOpenResult`.

### Modes

All three checkout modes are ready.

| Mode | Status | Behavior |
|---|---|---|
| `"redirect"` | Ready | Calls `location.assign(checkoutUrl)`. Page navigates away. |
| `"popup"` | Ready | Reserves a centered popup during the user action, then navigates it to checkout. Result includes `popup`. |
| `"embedded"` | Ready | Creates a sandboxed `<iframe>` inside `options.container`. Result includes `iframe`. |

### Options

```typescript
type CheckoutOptions = {
  amount: number              // required — smallest currency unit (cents for USD)
  currency?: string           // ISO-4217, defaults to "USD"
  reference?: string          // your internal order ID
  customer?: {
    email?: string
  }
  metadata?: Record<string, unknown>
  successUrl?: string         // redirect URL after successful payment
  cancelUrl?: string          // redirect URL after cancellation
  mode?: CheckoutMode         // "redirect" | "popup" | "embedded" — default "redirect"
  container?: string | HTMLElement  // required for embedded mode
  redirect?: boolean          // deprecated — use mode instead
}
```

### Result

```typescript
type CheckoutOpenResult = {
  sessionId: string
  status: string
  checkoutUrl: string
  reference: string | null
  paymentId: string | null
  iframe?: HTMLIFrameElement  // set in embedded mode
  popup?: Window              // set in popup mode
  on(event: CheckoutEventName, handler: CheckoutEventHandler): void
  off(event: CheckoutEventName, handler: CheckoutEventHandler): void
  destroy(): void
}
```

### Usage — redirect (default)

```javascript
import PineTree, { CheckoutSessionError, CheckoutInitializationError } from "@pinetreepayments/js"

const pinetree = new PineTree(process.env.NEXT_PUBLIC_PINETREE_PUBLIC_KEY)

// Navigates the page to the PineTree hosted checkout URL.
await pinetree.checkout.open({
  amount: 2500,
  currency: "USD",
  reference: "order_abc123",
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
})
```

### Usage — popup

```javascript
const result = await pinetree.checkout.open({
  amount: 2500,
  mode: "popup",
})

// result.popup is the Window reference to the popup.
// Throws CheckoutInitializationError (code: "popup_blocked") if the browser blocks the popup.
result.on("complete", ({ status }) => {
  console.log("Checkout status:", status)
})
```

### Usage — embedded

```javascript
const result = await pinetree.checkout.open({
  amount: 2500,
  mode: "embedded",
  container: "#checkout-container",  // or an HTMLElement
})

// result.iframe is the <iframe> element appended to the container.
result.on("complete", ({ status }) => {
  console.log("Checkout status:", status)
})
```

---

## Lifecycle Events

Hosted checkout emits browser-safe lifecycle events to its parent iframe or
popup opener. No wallet addresses, provider payloads, metadata, API keys, or
internal payment identifiers are included.

```typescript
result.on(event: CheckoutEventName, handler: (event: CheckoutEvent) => void): void
result.off(event: CheckoutEventName, handler: (event: CheckoutEvent) => void): void
result.destroy(): void
```

**Event names:** `"complete"`, `"failed"`, `"expired"`, `"canceled"`, `"closed"`

```typescript
result.on("complete", (event) => {
  console.log(event.event)     // "complete"
  console.log(event.status)    // "paid"
  console.log(event.sessionId) // session ID
  console.log(event.version)   // 1
})
```

The SDK accepts messages only from the hosted checkout origin, matching
popup/iframe window, matching session, supported version, and supported event.

```json
{
  "source": "pinetree-checkout",
  "version": 1,
  "event": "complete",
  "sessionId": "<session-id>",
  "status": "paid"
}
```

Call `off()` to remove one handler. Call `destroy()` to remove the message
listener and dispose of the SDK-created iframe or popup. Developer-owned
containers are never removed.

---

## Types

```typescript
type CheckoutMode = "redirect" | "popup" | "embedded"

type CheckoutEventName = "complete" | "failed" | "expired" | "canceled" | "closed"

type CheckoutEventPayload = {
  source: "pinetree-checkout"
  version: 1
  event: CheckoutEventName
  sessionId: string
  status: string
}

type CheckoutEvent = CheckoutEventPayload
type CheckoutEventHandler = (event: CheckoutEventPayload) => void

type CheckoutOpenResult = {
  sessionId: string
  status: string
  checkoutUrl: string
  reference: string | null
  paymentId: string | null
  iframe?: HTMLIFrameElement
  popup?: Window
  on(event: CheckoutEventName, handler: CheckoutEventHandler): void
  off(event: CheckoutEventName, handler: CheckoutEventHandler): void
  destroy(): void
}
```

All types are available as named imports:

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
} from "@pinetreepayments/js"
```

---

## Public key management

### Dashboard

Public keys are managed in the merchant dashboard under **Developer → Public Keys**.

### API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/merchant/public-keys` | List active public keys |
| `POST` | `/api/merchant/public-keys` | Create a new public key |
| `DELETE` | `/api/merchant/public-keys/:id` | Disable a public key |

#### Create a public key

```bash
curl -X POST https://app.pinetree-payments.com/api/merchant/public-keys \
  -H "Authorization: Bearer <pt_live_...>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Production frontend" }'
```

Response:
```json
{
  "key": {
    "id": "uuid",
    "name": "Production frontend",
    "key": "pk_live_<64-hex>",
    "prefix": "pk_live_<12-hex>",
    "createdAt": "2026-06-13T12:00:00.000Z"
  }
}
```

> The `key` field is shown only once. Store it securely before closing the response.

---

## Browser checkout endpoint

The browser SDK authenticates via the `X-PineTree-Public-Key` header (not
`Authorization: Bearer`).

```
POST /api/v1/browser/checkout/sessions
X-PineTree-Public-Key: pk_live_...
Content-Type: application/json

{
  "amount": 2500,
  "currency": "USD",
  "reference": "order_abc123"
}
```

The response shape is identical to `POST /api/v1/checkout/sessions`.

---

## Error classes

| Class | When thrown |
|---|---|
| `PineTreeBrowserError` | Base class — any SDK error |
| `CheckoutInitializationError` | Invalid/missing public key (401), popup blocked, missing/invalid container, or constructor misconfiguration |
| `CheckoutSessionError` | Session creation failed (400, 422, 500), or network error |

All errors expose `.message`, `.code`, and `.type`.

```javascript
import {
  PineTreeBrowserError,
  CheckoutInitializationError,
  CheckoutSessionError,
} from "@pinetreepayments/js"

try {
  await pinetree.checkout.open({ amount: 2500 })
} catch (err) {
  if (err instanceof CheckoutInitializationError) {
    // err.code: "invalid_public_key" | "popup_blocked" | "missing_container"
    //         | "container_not_found" | "invalid_container"
  } else if (err instanceof CheckoutSessionError) {
    console.error(err.code, err.message)
  }
}
```

---

## TypeScript support

The package ships with full TypeScript declarations in `dist/types/`. All public
types are exported from the package root.

---

## Relationship to the Node SDK

| | `@pinetreepayments/node` | `@pinetreepayments/js` |
|---|---|---|
| Environment | Node.js server-side | Browser (and Node bundlers) |
| Auth | Secret `pt_live_*` API key | Public `pk_live_*` key |
| Checkout | Creates sessions server-side | Opens hosted checkout via redirect, popup, or iframe |
| Events | Webhooks + `constructEvent()` | `postMessage` via `.on()` |
| Status | Ready for release | Ready |

Never use `@pinetreepayments/node` in the browser — it requires secret API keys.

---

## Roadmap

| Feature | Description |
|---|---|
| React SDK (`@pinetreepayments/react`) | React hooks and pre-built components |
| WooCommerce Plugin | Drop-in PineTree payment gateway for WooCommerce |
| Shopify Plugin | Native Shopify checkout integration |

---

## Integration testing

To test `checkout.open()` locally:

1. Set `baseUrl: "http://localhost:3000"` in the PineTree constructor.
2. Run the development server.
3. Create a public key via the dashboard or `POST /api/merchant/public-keys`.
4. Use `mode: "popup"` or `mode: "embedded"` to test without navigating away.

---

## Security

- **Never expose `pt_live_*` API keys in browser code.** These are server-side
  secrets and must stay on the server (`@pinetreepayments/node`).
- Public keys (`pk_live_*`) can safely be committed to client-side code and
  environment variables prefixed `NEXT_PUBLIC_`.
- Public keys can only create checkout sessions — they cannot access payments,
  webhooks, or any other merchant data.
- The embedded iframe is created with a restrictive `sandbox` attribute
  (`allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox`).
- `@pinetreepayments/js` contains no Node.js built-ins and will not work in a pure
  Node environment without a bundler.
