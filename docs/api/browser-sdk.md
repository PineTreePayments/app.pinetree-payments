# Browser JavaScript SDK

**Package:** `@pinetreepayments/js`

The PineTree browser JavaScript SDK lets you start checkout sessions directly from browser code using a **public key** — no server-side proxy required. The SDK creates the session via a public-key-gated API endpoint and launches the PineTree hosted checkout in one of three modes.

---

## When to use the Browser SDK

Use the Browser SDK when you want to launch checkout directly from a website or web app without a server-side session creation step. The public key can be safely embedded in front-end code.

**Do not use the Browser SDK for:**
- Accessing payment status or history (use the Node SDK on your server)
- Verifying webhooks (use the Node SDK on your server)
- Any operation that requires a secret API key (`pt_live_*`)

---

## Installation

```bash
npm install @pinetreepayments/js
```

Or via script tag (coming soon):

```html
<script src="https://js.pinetree-payments.com/v1"></script>
```

---

## Initialization

```typescript
import { PineTree } from "@pinetreepayments/js"

const pinetree = new PineTree("pk_live_your_public_key_here")
```

You can also pass an options object:

```typescript
const pinetree = new PineTree({
  publicKey: "pk_live_your_public_key_here",
  baseUrl: "https://app.pinetree-payments.com", // optional, defaults to production
})
```

---

## Opening a checkout

`pinetree.checkout.open(options)` creates a checkout session and launches the hosted checkout experience. It returns a `CheckoutOpenResult` with lifecycle methods.

```typescript
const result = await pinetree.checkout.open({
  amount: 2500,          // in cents — $25.00
  currency: "USD",
  reference: "order_1042",
  customer: { email: "jane@example.com" },
  rails: ["solana", "base"],
  successUrl: "https://yoursite.com/success",
  cancelUrl: "https://yoursite.com/cancel",
  mode: "redirect",      // "redirect" | "popup" | "embedded"
})
```

### Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `amount` | number | Yes | Amount in smallest unit (cents for USD) |
| `currency` | string | No | ISO 4217 currency code. Defaults to `"USD"` |
| `reference` | string | No | Your internal order ID — passed through to webhooks |
| `customer.email` | string | No | Customer email |
| `metadata` | object | No | Arbitrary metadata passed to the session |
| `rails` | string[] | No | Restrict which network rails to offer |
| `successUrl` | string | No | URL to redirect after successful payment |
| `cancelUrl` | string | No | URL to redirect after cancellation |
| `mode` | string | No | `"redirect"` (default), `"popup"`, or `"embedded"` |
| `container` | string \| HTMLElement | No | Required when `mode: "embedded"` |

Supported hosted checkout assets are SOL on Solana, USDC on Solana, ETH on
Base, USDC on Base, BTC over Lightning, and cards where Shift4 is enabled. Use
`rails: ["solana"]` to offer the Solana rail; customers can then choose SOL or
USDC on Solana in hosted checkout.

---

## Checkout modes

### `redirect` (default)

Navigates the current page to the PineTree hosted checkout. On completion, the customer is redirected back to your `successUrl` or `cancelUrl`.

```typescript
await pinetree.checkout.open({
  amount: 2500,
  mode: "redirect",
  successUrl: "https://yoursite.com/success",
})
// page navigates to checkout
```

### `popup`

Opens a centered popup window containing the hosted checkout. The parent page stays open. Lifecycle events are delivered via `window.postMessage`.

```typescript
const result = await pinetree.checkout.open({
  amount: 2500,
  mode: "popup",
})

result.on("complete", (event) => {
  console.log("Payment complete:", event.sessionId)
})

result.on("closed", () => {
  console.log("Popup was closed")
  result.destroy() // clean up
})
```

### `embedded`

Renders an iframe inside a container element you provide. Lifecycle events are delivered via `window.postMessage`.

```typescript
const result = await pinetree.checkout.open({
  amount: 2500,
  mode: "embedded",
  container: "#checkout-container", // CSS selector or HTMLElement
})

result.on("complete", (event) => {
  console.log("Paid:", event.status)
  result.destroy() // remove the iframe
})
```

---

## Lifecycle events

The `CheckoutOpenResult` object returned by `open()` emits lifecycle events from the hosted checkout:

```typescript
type CheckoutEventName = "complete" | "failed" | "expired" | "canceled" | "closed"

result.on("complete", (event: CheckoutEventPayload) => { ... })
result.on("failed",   (event: CheckoutEventPayload) => { ... })
result.on("expired",  (event: CheckoutEventPayload) => { ... })
result.on("canceled", (event: CheckoutEventPayload) => { ... })
result.on("closed",   (event: CheckoutEventPayload) => { ... })

// Remove a listener
result.off("complete", handler)

// Clean up iframe or popup window
result.destroy()
```

### Event payload

```typescript
{
  source: "pinetree-checkout"
  version: 1
  event: CheckoutEventName
  sessionId: string
  status: string  // checkout session status
}
```

---

## CheckoutOpenResult fields

```typescript
{
  sessionId: string           // "cs_01abc..."
  status: string              // "open" at creation time
  checkoutUrl: string         // the hosted checkout URL
  reference: string | null    // your order reference
  paymentId: string | null    // set after payment attempt

  iframe?: HTMLIFrameElement  // present when mode: "embedded"
  popup?: Window              // present when mode: "popup"

  on(event, handler): void
  off(event, handler): void
  destroy(): void             // close popup / remove iframe / remove listeners
}
```

---

## Security notes

- Public keys (`pk_live_*`) are **safe to expose in browser code**. They can only create checkout sessions.
- **Never use secret API keys (`pt_live_*`) in browser code.** Secret keys grant access to payment history, webhook management, and other sensitive operations.
- Lifecycle events use `window.postMessage` from the checkout origin. The SDK validates the source before forwarding events.
- Your `successUrl` and `cancelUrl` must be on your own domain — they are not validated by the SDK but PineTree validates them at session creation.

---

## React SDK

If you are using React, use `@pinetreepayments/react` instead. It provides the same functionality with a React-native API:

```bash
npm install @pinetreepayments/react
```

See [React SDK](./react-sdk.md) for details.

---

## Status

Ready for release. The Browser SDK is fully functional, tested, and published as `@pinetreepayments/js` v0.1.0.
