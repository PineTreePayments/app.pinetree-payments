# Node SDK — Create a Checkout Session

This example covers the full create flow: initializing the client, creating a
session with all common options, redirecting the customer, and handling errors.

## Prerequisites

- Node.js 18 or later
- `@pinetree/node` installed from a local path or workspace reference until npm publication
- A `pt_live_*` API key from the PineTree dashboard

## Basic usage

```typescript
import PineTree from "@pinetree/node"

const client = new PineTree(process.env.PINETREE_API_KEY!)

const session = await client.checkout.sessions.create({
  amount: 2500,           // cents — $25.00 USD
  currency: "USD",
  reference: "order_abc123",
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
})

console.log(session.id)           // "cs_..."
console.log(session.checkoutUrl)  // redirect the customer here
console.log(session.status)       // "open"
console.log(session.expiresAt)    // ISO-8601 expiry timestamp
```

## Full options

```typescript
const session = await client.checkout.sessions.create({
  // Required
  amount: 2500,

  // Optional — defaults to "USD"
  currency: "USD",

  // Your internal order reference — returned on every session object
  // and on the resulting Payment. Useful for reconciliation.
  reference: "order_abc123",

  // Customer info — stored with the session, not required for payment
  customer: {
    email: "alice@example.com",
  },

  // Arbitrary key/value metadata — returned as-is on the session and payment
  metadata: {
    plan: "pro",
    userId: "usr_7891",
  },

  // Restrict to specific payment rails. Omit to accept all supported rails.
  rails: ["solana_usdc", "base_usdc"],

  // Redirect URLs after payment or cancellation
  successUrl: "https://example.com/success?session_id={SESSION_ID}",
  cancelUrl: "https://example.com/cancel",
})
```

## Idempotency

Pass an `idempotencyKey` to safely retry a session creation request without
creating duplicate sessions:

```typescript
const session = await client.checkout.sessions.create(
  {
    amount: 2500,
    currency: "USD",
    reference: "order_abc123",
  },
  {
    idempotencyKey: "order_abc123_attempt_1",
  }
)
```

If the same key is used again with identical parameters, the original session is
returned. Using the same key with different parameters throws
`IdempotencyConflictError`. Keys expire after 24 hours.

## Error handling

```typescript
import PineTree, {
  AuthenticationError,
  InvalidRequestError,
  IdempotencyConflictError,
  APIConnectionError,
} from "@pinetree/node"

try {
  const session = await client.checkout.sessions.create(
    { amount: 2500, currency: "USD" },
    { idempotencyKey: "order_abc123_attempt_1" }
  )
  res.redirect(session.checkoutUrl)
} catch (err) {
  if (err instanceof AuthenticationError) {
    // Invalid or revoked API key — check PINETREE_API_KEY
    console.error("Authentication failed:", err.message)
    res.status(500).send("Payment configuration error")
  } else if (err instanceof IdempotencyConflictError) {
    // Same idempotency key used with different params
    console.error("Idempotency conflict:", err.message)
    res.status(409).send("Request conflict")
  } else if (err instanceof InvalidRequestError) {
    // Bad amount, invalid currency, etc.
    console.error("Invalid request:", err.message, err.code)
    res.status(400).send("Invalid payment parameters")
  } else if (err instanceof APIConnectionError) {
    // Network failure — safe to retry
    console.error("Connection error:", err.message)
    res.status(503).send("Payment service temporarily unavailable")
  } else {
    throw err
  }
}
```

## Express integration example

```typescript
import express from "express"
import PineTree, { AuthenticationError, APIConnectionError } from "@pinetree/node"

const app = express()
app.use(express.json())

const client = new PineTree(process.env.PINETREE_API_KEY!)

app.post("/checkout", async (req, res) => {
  const { orderId, amountCents, customerEmail } = req.body

  try {
    const session = await client.checkout.sessions.create(
      {
        amount: amountCents,
        currency: "USD",
        reference: orderId,
        customer: { email: customerEmail },
        successUrl: `https://example.com/orders/${orderId}/success`,
        cancelUrl: `https://example.com/orders/${orderId}`,
      },
      { idempotencyKey: `order_${orderId}_checkout` }
    )

    res.json({ checkoutUrl: session.checkoutUrl, sessionId: session.id })
  } catch (err) {
    if (err instanceof APIConnectionError) {
      res.status(503).json({ error: "Payment service unavailable" })
    } else {
      console.error("Checkout session error:", err)
      res.status(500).json({ error: "Internal error" })
    }
  }
})
```

## Next.js App Router example

```typescript
// app/api/checkout/route.ts
import { NextRequest, NextResponse } from "next/server"
import PineTree from "@pinetree/node"

const client = new PineTree(process.env.PINETREE_API_KEY!)

export async function POST(req: NextRequest) {
  const { orderId, amountCents } = await req.json()

  const session = await client.checkout.sessions.create(
    {
      amount: amountCents,
      currency: "USD",
      reference: orderId,
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/orders/${orderId}/success`,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/orders/${orderId}`,
    },
    { idempotencyKey: `order_${orderId}_checkout` }
  )

  return NextResponse.json({ checkoutUrl: session.checkoutUrl })
}
```

## Session object reference

```typescript
type CheckoutSession = {
  id: string
  object: "checkout.session"
  status: "open" | "processing" | "paid" | "failed" | "expired" | "canceled"
  amount: number                  // smallest currency unit (cents for USD)
  currency: string                // ISO-4217 uppercase ("USD")
  reference: string | null        // your order reference
  customer: { email: string | null }
  metadata: Record<string, unknown>
  checkoutUrl: string             // redirect customers here
  paymentId: string | null        // set when status becomes "paid"
  supportedRails: string[]
  successUrl: string | null
  cancelUrl: string | null
  createdAt: string               // ISO-8601
  expiresAt: string | null        // ISO-8601
}
```
