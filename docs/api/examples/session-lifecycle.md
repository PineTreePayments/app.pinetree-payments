# Checkout Session Lifecycle

A PineTree checkout session moves through a defined set of statuses from
creation to terminal state.

## Status transitions

```
                     ┌─────────────────┐
                     │     created     │
                     └────────┬────────┘
                              │ POST /checkout/sessions
                              ▼
                     ┌─────────────────┐
         ┌──cancel───│      open       │───expire──────────┐
         │           └────────┬────────┘                   │
         │                    │ customer begins payment     │
         │                    ▼                             │
         │           ┌─────────────────┐                   │
         │           │   processing    │                   │
         │           └────────┬────────┘                   │
         │               ╱         ╲                        │
         │          paid             failed                 │
         │            ▼               ▼                     │
         │     ┌──────────┐   ┌──────────┐   ┌──────────┐ │
         └────▶│ canceled │   │  failed  │   │ expired  │◀┘
               └──────────┘   └──────────┘   └──────────┘
                                      ▲
                                      │
                              ┌───────────────┐
                              │     paid      │
                              └───────────────┘
```

## Status values

| Status | Description | Terminal |
|---|---|---|
| `open` | Session created; awaiting customer action | No |
| `processing` | Customer has initiated payment; awaiting on-chain confirmation | No |
| `paid` | Payment confirmed on-chain | Yes |
| `failed` | Payment attempt failed (e.g. rejected transaction) | Yes |
| `expired` | Session passed its expiry time without payment | Yes |
| `canceled` | Merchant canceled the session | Yes |

Terminal sessions cannot be modified. Cancel and expire calls on terminal
sessions return the existing session without error (idempotent).

## Operations

### Create

```typescript
const session = await client.checkout.sessions.create({
  amount: 2500,
  currency: "USD",
  reference: "order_abc123",
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
})
// session.status === "open"
// Redirect customer to session.checkoutUrl
```

### Poll for status (not recommended — use webhooks instead)

```typescript
async function waitForPayment(sessionId: string, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const session = await client.checkout.sessions.retrieve(sessionId)
    if (["paid", "failed", "expired", "canceled"].includes(session.status)) {
      return session
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error("Timed out waiting for session")
}
```

Prefer webhooks for production. Polling is appropriate only for
short-lived admin scripts.

### Retrieve

```typescript
const session = await client.checkout.sessions.retrieve("cs_...")
console.log(session.status)    // current status
console.log(session.paymentId) // set when status is "paid"
```

### Cancel

Merchant-initiated cancellation. Only valid on `open` or `processing` sessions.

```typescript
const canceled = await client.checkout.sessions.cancel("cs_...")
// canceled.status === "canceled"
```

Use this when a customer abandons checkout on your side or when an order is
voided before payment completes.

### Expire

Platform-side expiry. Useful to manually expire sessions that have passed
your own time threshold before the automatic expiry fires.

```typescript
const expired = await client.checkout.sessions.expire("cs_...")
// expired.status === "expired"
```

### List by status

```typescript
// All open sessions
const open = await client.checkout.sessions.list({ status: "open" })

// All paid sessions for reconciliation
const paid = await client.checkout.sessions.list({
  status: "paid",
  createdAfter: "2026-06-01T00:00:00Z",
  limit: 100,
})

// Sessions for a specific order reference
const byOrder = await client.checkout.sessions.list({
  reference: "order_abc123",
})
```

### Paginate

```typescript
async function* paginateSessions(status: string) {
  let cursor: string | null = null

  do {
    const page = await client.checkout.sessions.list({
      status,
      limit: 100,
      cursor: cursor ?? undefined,
    })
    yield* page.data
    cursor = page.hasMore ? page.nextCursor : null
  } while (cursor)
}

for await (const session of paginateSessions("paid")) {
  console.log(session.id, session.reference, session.paymentId)
}
```

## Webhook-driven lifecycle

The recommended pattern is to create the session, redirect the customer, and
let webhooks drive your system state:

```typescript
// 1. Create session and redirect
const session = await client.checkout.sessions.create({ ... })
res.redirect(session.checkoutUrl)

// 2. Handle outcome via webhook
// app/api/webhooks/pinetree/route.ts
switch (event.type) {
  case "checkout.session.completed": {
    const session = event.data.object as CheckoutSession
    await db.orders.update({
      where: { reference: session.reference },
      data: {
        status: "paid",
        paymentId: session.paymentId,
        paidAt: new Date(),
      },
    })
    await sendConfirmationEmail(session.customer.email)
    break
  }

  case "checkout.session.expired":
  case "checkout.session.canceled": {
    const session = event.data.object as CheckoutSession
    await db.orders.update({
      where: { reference: session.reference },
      data: { status: session.status },
    })
    break
  }

  case "checkout.session.failed":
    // Payment failed but session may still be open for retry
    // depending on your configuration
    break
}
```

## Retrieve the resulting payment

Once a session reaches `paid`, `session.paymentId` is set. Use it to retrieve
the full payment record:

```typescript
const session = await client.checkout.sessions.retrieve("cs_...")
if (session.status === "paid" && session.paymentId) {
  const payment = await client.payments.retrieve(session.paymentId)
  console.log(payment.network) // "solana", "base", etc.
  console.log(payment.rail)    // "solana", "base", etc.
}
```

## Idempotent create-or-retrieve pattern

Use an idempotency key tied to your order ID to avoid creating duplicate
sessions on retry:

```typescript
async function getOrCreateSession(orderId: string, amountCents: number) {
  // First, check for an existing open session for this order
  const existing = await client.checkout.sessions.list({
    reference: orderId,
    status: "open",
    limit: 1,
  })
  if (existing.data.length > 0) {
    return existing.data[0]
  }

  // Create a new session with an idempotency key
  return client.checkout.sessions.create(
    {
      amount: amountCents,
      currency: "USD",
      reference: orderId,
    },
    { idempotencyKey: `order_${orderId}_session_v1` }
  )
}
```
