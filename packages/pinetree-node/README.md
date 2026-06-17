# @pinetreepayments/node

Official Node.js SDK for [PineTree Payments](https://app.pinetree-payments.com).

**Requirements:** Node.js 18 or later · TypeScript 5+ (optional but recommended)

---

## Installation

```bash
npm install @pinetreepayments/node
```

---

## Quick start

```typescript
import PineTree from "@pinetreepayments/node"

const client = new PineTree(process.env.PINETREE_API_KEY!)

// Create a checkout session
const session = await client.checkout.sessions.create({
  amount: 2500,           // $25.00 USD (amount in cents)
  currency: "USD",
  reference: "order_abc123",
  successUrl: "https://example.com/success",
  cancelUrl:  "https://example.com/cancel",
})

// Redirect the customer to complete payment
console.log(session.checkoutUrl)
```

---

## API key

PineTree uses a single key format for all environments:

```
pt_live_<64 hex characters>
```

> **Security — server-only:** `pt_live_*` API keys grant full merchant access
> and must **never** appear in browser code, React applications, or any
> `NEXT_PUBLIC_` environment variable. For client-side checkout flows, use
> `@pinetreepayments/js` or `@pinetreepayments/react` with a `pk_live_*` public key instead.

Generate API keys from the **PineTree dashboard → Developer**. Pass the key
when constructing the client, or set it via options:

```typescript
// String shorthand
const client = new PineTree("pt_live_...")

// Options object
const client = new PineTree({
  apiKey: "pt_live_...",
  baseUrl: "http://localhost:3000",  // override for local dev / integration tests
  timeout: 30_000,                   // ms; default is 30s
})
```

---

## Checkout Sessions

### Create

```typescript
const session = await client.checkout.sessions.create({
  amount: 2500,               // required — smallest currency unit (cents for USD)
  currency: "USD",            // optional; defaults to "USD"
  reference: "order_abc123",  // optional — your internal order ID
  customer: {
    email: "alice@example.com",
  },
  metadata: {
    plan: "pro",
    userId: "usr_7891",
  },
  // Optional: restrict checkout to network rails.
  // Solana checkout offers SOL on Solana and USDC on Solana.
  rails: ["solana", "base"],
  successUrl: "https://example.com/success",
  cancelUrl:  "https://example.com/cancel",
})
// session.status === "open"
// Redirect the customer to session.checkoutUrl
```

Supported hosted checkout assets are SOL on Solana, USDC on Solana, ETH on
Base, USDC on Base, BTC over Lightning, and cards where Shift4 is enabled.
The `rails` option restricts network rails; it does not preselect a token.

### Create with idempotency key

```typescript
const session = await client.checkout.sessions.create(
  { amount: 2500, currency: "USD", reference: "order_abc123" },
  { idempotencyKey: "order_abc123_attempt_1" }
)
```

Idempotency keys expire after 24 hours. Reusing a key with the same params
returns the original session. Reusing with different params throws
`IdempotencyConflictError`.

### Retrieve

```typescript
const session = await client.checkout.sessions.retrieve("cs_...")
```

### List

```typescript
const list = await client.checkout.sessions.list({
  status: "open",
  reference: "order_abc123",
  limit: 20,
  cursor: list.nextCursor,      // for pagination
  createdAfter: "2026-06-01T00:00:00Z",
  createdBefore: "2026-06-30T23:59:59Z",
})
// list.hasMore, list.nextCursor
```

### Cancel

```typescript
const session = await client.checkout.sessions.cancel("cs_...")
// session.status === "canceled"
```

### Expire

```typescript
const session = await client.checkout.sessions.expire("cs_...")
// session.status === "expired"
```

---

## Payments

```typescript
const payment = await client.payments.retrieve("pay_...")
// payment.status, payment.network, payment.rail
```

---

## Webhook Deliveries

```typescript
// List delivery attempts
const deliveries = await client.webhookDeliveries.list({ status: "failed" })

// Retry a failed delivery
await client.webhookDeliveries.retry("wdl_...")
```

---

## Webhook Verification

Verify the HMAC-SHA256 signature on incoming webhook deliveries using
`constructEvent`. Pass the **raw body bytes** — do not parse JSON first.

### Express

```typescript
import express from "express"
import PineTree, { WebhookVerificationError } from "@pinetreepayments/node"

const app = express()
const client = new PineTree(process.env.PINETREE_API_KEY!)

app.post(
  "/webhooks/pinetree",
  express.raw({ type: "*/*" }),  // raw body — do NOT use express.json() here
  (req, res) => {
    let event
    try {
      event = client.webhooks.constructEvent(
        req.body,
        req.headers as Record<string, string>,
        process.env.PINETREE_WEBHOOK_SECRET!
      )
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        return res.status(400).send("Signature verification failed")
      }
      throw err
    }

    switch (event.type) {
      case "checkout.session.paid":
        // Fulfill the order
        break
      case "checkout.session.expired":
        // Mark as expired
        break
    }

    res.status(200).end()
  }
)
```

### Next.js App Router

```typescript
// app/api/webhooks/pinetree/route.ts
import { NextRequest, NextResponse } from "next/server"
import PineTree, { WebhookVerificationError } from "@pinetreepayments/node"

const client = new PineTree(process.env.PINETREE_API_KEY!)

export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer())

  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })

  let event
  try {
    event = client.webhooks.constructEvent(
      rawBody,
      headers,
      process.env.PINETREE_WEBHOOK_SECRET!
    )
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }
    throw err
  }

  switch (event.type) {
    case "checkout.session.paid":
      break
  }

  return NextResponse.json({ received: true })
}
```

### `constructEvent` overloads

```typescript
// Header-object form (recommended) — also verifies PineTree-Event-Id and version
client.webhooks.constructEvent(rawBody, headersObject, secret)

// Individual-values form
client.webhooks.constructEvent(rawBody, signature, timestamp, secret)
```

The default replay window is **300 seconds (5 minutes)**. Events with a
`PineTree-Timestamp` older than the window are rejected.

---

## Webhook headers

| Header | Value |
|---|---|
| `PineTree-Signature` | `sha256=<hmac-sha256-hex>` |
| `PineTree-Timestamp` | ISO-8601 event timestamp |
| `PineTree-Event-Id` | Unique event ID (use for deduplication) |
| `PineTree-Webhook-Version` | `2026-06-12` |

---

## Error handling

All SDK errors extend `PineTreeError`:

```typescript
import PineTree, {
  PineTreeError,
  AuthenticationError,
  PermissionError,
  InvalidRequestError,
  IdempotencyConflictError,
  APIConnectionError,
  WebhookVerificationError,
} from "@pinetreepayments/node"

try {
  await client.checkout.sessions.create({ amount: 2500, currency: "USD" })
} catch (err) {
  if (err instanceof AuthenticationError) {
    // HTTP 401 — invalid or revoked API key
  } else if (err instanceof PermissionError) {
    // HTTP 403 — key lacks required permission
  } else if (err instanceof IdempotencyConflictError) {
    // Idempotency key reused with different params
  } else if (err instanceof InvalidRequestError) {
    // HTTP 400/404/409 — bad request, not found, or conflict
    console.log(err.code, err.message)
  } else if (err instanceof APIConnectionError) {
    // Network failure — safe to retry
  } else if (err instanceof PineTreeError) {
    // Other API errors
    console.log(err.status, err.type, err.code, err.requestId)
  }
}
```

### Error properties

```typescript
err.message    // Human-readable description
err.status     // HTTP status code (if applicable)
err.type       // API error type string
err.code       // API error code string
err.requestId  // Request ID for support debugging
```

---

## Session status values

```typescript
type CheckoutSessionStatus =
  | "open"        // awaiting customer action
  | "processing"  // payment in progress on-chain
  | "paid"        // confirmed
  | "failed"      // payment failed
  | "expired"     // session timed out
  | "canceled"    // merchant canceled
```

---

## TypeScript types

All types are exported from the package root:

```typescript
import type {
  CheckoutSession,
  CheckoutSessionCreateParams,
  CheckoutSessionCreateOptions,
  CheckoutSessionListParams,
  CheckoutSessionList,
  CheckoutSessionStatus,
  Payment,
  WebhookDelivery,
  WebhookDeliveryList,
  WebhookDeliveryStatus,
  Event,
  PineTreeOptions,
  PineTreeWebhookHeaderObject,
} from "@pinetreepayments/node"
```

---

## Module formats

The package ships ESM and CommonJS builds with TypeScript declarations:

| Format | Entry point |
|---|---|
| ESM | `dist/esm/index.js` |
| CommonJS | `dist/cjs/index.js` |
| Types | `dist/types/index.d.ts` |

---

## Development

```bash
# Build
npm run build --workspace packages/pinetree-node

# Type-check
npm run typecheck --workspace packages/pinetree-node

# Offline unit tests
npm test --workspace packages/pinetree-node

# Release-candidate validation (typecheck → build → tests → pack check)
npm run release-candidate --workspace packages/pinetree-node
```

### Integration tests

Integration tests require a running server and are opt-in:

```bash
# Create a local integration key
node packages/pinetree-node/scripts/setup-integration.mjs \
  --merchant-id <your-merchant-uuid>

# Run against localhost
npm run test:integration:local --workspace packages/pinetree-node
```

See [docs/api/node-sdk-integration-testing.md](../../docs/api/node-sdk-integration-testing.md)
for the full setup guide.

---

## Changelog

### 0.1.0 (2026-06-12)

Initial package release.

- Checkout sessions: create, retrieve, list, cancel, expire
- Payments: retrieve
- Webhook deliveries: list, retry
- Webhook verification: `constructEvent` with HMAC-SHA256
- ESM + CJS + TypeScript declarations
- Idempotency support via `Idempotency-Key` header
