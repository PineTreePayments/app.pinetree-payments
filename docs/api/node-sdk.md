# Node SDK

**Package:** `@pinetreepayments/node`

The PineTree Node SDK provides a typed client for the PineTree REST API. Use it on your server to create checkout sessions, retrieve payments, manage webhook deliveries, and verify incoming webhook signatures.

---

## Installation

```bash
npm install @pinetreepayments/node
```

---

## Initialize the client

```typescript
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)
```

Pass an options object for explicit configuration:

```typescript
const pinetree = new PineTree({
  apiKey: process.env.PINETREE_API_KEY!,
  baseUrl: "https://app.pinetree-payments.com",  // default
  timeout: 30_000,                                // ms, default 30s
})
```

The `apiKey` must be set. The constructor throws `AuthenticationError` immediately if no key is provided.

---

## Checkout Sessions

### Create a session

```typescript
const session = await pinetree.checkout.sessions.create(
  {
    amount: 2500,
    currency: "USD",
    reference: "order_1042",
    customer: { email: "jane@example.com" },
    metadata: { productId: "prod_abc" },
    // Optional: restrict network rails. Solana offers SOL and USDC.
    rails: ["solana", "base"],
    successUrl: "https://yoursite.com/success",
    cancelUrl: "https://yoursite.com/cancel",
  },
  {
    idempotencyKey: "order_1042",  // optional — prevents duplicate sessions
  }
)

// Redirect the customer
res.redirect(session.checkoutUrl)
```

### Retrieve a session

```typescript
const session = await pinetree.checkout.sessions.retrieve("cs_01abc...")
console.log(session.status) // "open" | "paid" | "failed" | ...
```

### List sessions

```typescript
const list = await pinetree.checkout.sessions.list({
  status: "paid",
  limit: 20,
  createdAfter: "2026-06-01T00:00:00.000Z",
})

for (const session of list.data) {
  console.log(session.id, session.reference)
}

// Paginate
if (list.hasMore) {
  const next = await pinetree.checkout.sessions.list({
    startingAfter: list.nextCursor!,
  })
}
```

### Cancel a session

```typescript
const updated = await pinetree.checkout.sessions.cancel("cs_01abc...")
console.log(updated.status) // "canceled"
```

### Expire a session

```typescript
const updated = await pinetree.checkout.sessions.expire("cs_01abc...")
console.log(updated.status) // "expired"
```

---

## Payments

### Retrieve a payment

```typescript
const payment = await pinetree.payments.retrieve("pay_01abc...")
console.log(payment.status)   // "paid"
console.log(payment.network)  // "solana"
console.log(payment.rail)     // "solana"
```

Supported hosted checkout assets are SOL on Solana, USDC on Solana, ETH on
Base, USDC on Base, BTC over Lightning, and cards where Shift4 is enabled.

---

## Webhook Deliveries

### List deliveries

```typescript
const list = await pinetree.webhookDeliveries.list({
  status: "failed",
  eventType: "payment.confirmed",
  limit: 50,
})
```

### Retry a delivery

```typescript
const delivery = await pinetree.webhookDeliveries.retry("wdel_01abc...")
console.log(delivery.status)       // "delivered" if retry succeeded
console.log(delivery.attemptCount) // number of total attempts
```

---

## Verify a webhook signature

The `pinetree.webhooks.constructEvent()` method verifies the HMAC-SHA256 signature, checks the timestamp tolerance (5 minutes), and parses the event payload.

```typescript
import express from "express"
import { PineTree } from "@pinetreepayments/node"
import type { Payment } from "@pinetreepayments/node"

const app = express()
const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

// IMPORTANT: use express.raw() — the body must not be JSON-parsed before verification
app.post("/webhooks/pinetree", express.raw({ type: "application/json" }), (req, res) => {
  let event
  try {
    event = pinetree.webhooks.constructEvent(
      req.body,
      req.headers as Record<string, string>,
      process.env.PINETREE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error("Verification failed:", err)
    return res.status(400).send(`Webhook error: ${(err as Error).message}`)
  }

  switch (event.type) {
    case "payment.confirmed": {
      const payment = event.data.object as Payment
      console.log("Payment confirmed:", payment.id, payment.reference)
      // fulfill order here
      break
    }
    case "payment.failed": {
      console.log("Payment failed:", (event.data.object as Payment).id)
      break
    }
  }

  res.json({ received: true })
})
```

You can also pass `signature`, `timestamp`, and `secret` separately:

```typescript
event = pinetree.webhooks.constructEvent(
  rawBody,
  req.headers["pinetree-signature"] as string,
  req.headers["pinetree-timestamp"] as string,
  process.env.PINETREE_WEBHOOK_SECRET!
)
```

---

## Error handling

The SDK throws typed errors for all API and verification failures:

```typescript
import {
  PineTree,
  AuthenticationError,
  PermissionError,
  InvalidRequestError,
  APIConnectionError,
  IdempotencyConflictError,
  WebhookVerificationError,
} from "@pinetreepayments/node"

try {
  const session = await pinetree.checkout.sessions.create({ amount: 2500 })
} catch (err) {
  if (err instanceof AuthenticationError) {
    // Invalid or revoked API key (401)
    console.error("Auth error:", err.message, err.code)
  } else if (err instanceof PermissionError) {
    // Key lacks the required permission (403)
    console.error("Permission error:", err.message)
  } else if (err instanceof IdempotencyConflictError) {
    // Same Idempotency-Key with different body (409)
    console.error("Idempotency conflict:", err.message)
  } else if (err instanceof InvalidRequestError) {
    // Bad request (400, 404, 409)
    console.error("Invalid request:", err.message, err.code)
  } else if (err instanceof APIConnectionError) {
    // Network error or timeout
    console.error("Connection error:", err.message)
  } else {
    throw err
  }
}
```

### Error properties

| Property | Type | Description |
|----------|------|-------------|
| `message` | string | Human-readable error message |
| `status` | number | HTTP status code (if from API) |
| `code` | string | Machine-readable error code |
| `type` | string | Error type category |
| `requestId` | string | PineTree request ID for support |

---

## TypeScript

The SDK is written in TypeScript. All types are exported from the package root:

```typescript
import type {
  CheckoutSession,
  CheckoutSessionCreateParams,
  CheckoutSessionListParams,
  CheckoutSessionList,
  Payment,
  WebhookDelivery,
  WebhookDeliveryList,
  Event,
} from "@pinetreepayments/node"
```

---

## Next.js example

```typescript
// app/api/checkout/route.ts
import { NextRequest, NextResponse } from "next/server"
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

export async function POST(req: NextRequest) {
  const { orderId, amount } = await req.json() as { orderId: string; amount: number }

  const session = await pinetree.checkout.sessions.create(
    { amount, currency: "USD", reference: orderId },
    { idempotencyKey: orderId }
  )

  return NextResponse.json({ checkoutUrl: session.checkoutUrl })
}
```
