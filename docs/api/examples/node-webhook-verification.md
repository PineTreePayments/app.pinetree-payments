# Node SDK — Webhook Verification

PineTree signs every webhook delivery with HMAC-SHA256. Use
`client.webhooks.constructEvent()` to verify the signature and parse the
event payload in a single call.

## How signing works

PineTree generates an HMAC-SHA256 digest of
`PineTree-Timestamp + "." + raw request body` using your webhook secret and sends it in the `PineTree-Signature` header as
`sha256=<hex-digest>`. The `PineTree-Timestamp` header carries the ISO-8601
event time. `constructEvent` re-computes the HMAC and rejects events with a
timestamp older than 5 minutes (configurable per call).

## Webhook headers

| Header | Value |
|---|---|
| `PineTree-Signature` | `sha256=<hmac-sha256-hex>` |
| `PineTree-Timestamp` | ISO-8601 event timestamp |
| `PineTree-Event-Id` | Unique event ID for deduplication |
| `PineTree-Event-Schema` | `payments-v1` |

`PineTree-Webhook-Version` is sent alongside `PineTree-Event-Schema` for backwards compatibility. The SDK accepts either.

## Express

Read the **raw body bytes** before any body-parser middleware touches the
request. `constructEvent` must receive the unmodified bytes.

```typescript
import express from "express"
import PineTree, { WebhookVerificationError } from "@pinetreepayments/node"

const app = express()
const client = new PineTree(process.env.PINETREE_API_KEY!)
const webhookSecret = process.env.PINETREE_WEBHOOK_SECRET!

// Mount with raw body — do NOT use express.json() here
app.post(
  "/webhooks/pinetree",
  express.raw({ type: "*/*" }),
  (req, res) => {
    let event
    try {
      // Pass the full header object — the SDK reads the relevant headers
      event = client.webhooks.constructEvent(
        req.body,
        req.headers as Record<string, string>,
        webhookSecret
      )
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        console.error("Webhook verification failed:", err.message)
        return res.status(400).send("Signature verification failed")
      }
      throw err
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object
        // session is typed as unknown — cast to CheckoutSession if needed
        console.log("Payment received for session", session)
        // Fulfill the order here
        break
      }
      case "checkout.session.expired":
        console.log("Session expired:", event.eventId)
        break
      case "checkout.session.canceled":
        console.log("Session canceled:", event.eventId)
        break
      default:
        console.log("Unhandled event type:", event.type)
    }

    res.status(200).end()
  }
)
```

## Express with typed event data

```typescript
import type { CheckoutSession } from "@pinetreepayments/node"

// After constructEvent succeeds
switch (event.type) {
  case "checkout.session.completed": {
    const session = event.data.object as CheckoutSession
    await fulfillOrder(session.reference!, session.paymentId!)
    break
  }
}
```

## Next.js App Router

Next.js App Router provides the raw body via `req.arrayBuffer()`. Convert it
to a `Buffer` before passing to `constructEvent`.

```typescript
// app/api/webhooks/pinetree/route.ts
import { NextRequest, NextResponse } from "next/server"
import PineTree, { WebhookVerificationError } from "@pinetreepayments/node"

const client = new PineTree(process.env.PINETREE_API_KEY!)
const webhookSecret = process.env.PINETREE_WEBHOOK_SECRET!

export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer())

  // Build a plain header object from the Next.js Headers object
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  let event
  try {
    event = client.webhooks.constructEvent(rawBody, headers, webhookSecret)
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json(
        { error: "Signature verification failed" },
        { status: 400 }
      )
    }
    throw err
  }

  // Process the event
  switch (event.type) {
    case "checkout.session.completed":
      await handlePaid(event)
      break
    case "checkout.session.expired":
      await handleExpired(event)
      break
  }

  return NextResponse.json({ received: true })
}
```

## Passing individual header values

If you already have the header values as separate strings, use the
three-argument form:

```typescript
const event = client.webhooks.constructEvent(
  rawBody,
  req.headers["PineTree-Signature"] as string,
  req.headers["PineTree-Timestamp"] as string,
  webhookSecret
)
```

The four-argument form skips the `PineTree-Event-Id` cross-check and schema
check that the header-object form performs automatically.

## Deduplication

Use `event.eventId` to deduplicate deliveries in your database:

```typescript
const existing = await db.webhookEvents.findUnique({
  where: { eventId: event.eventId },
})
if (existing) {
  return res.status(200).end() // already processed
}

await db.webhookEvents.create({ data: { eventId: event.eventId } })
// then process ...
```

## Testing

Sign a fixture event locally using the same HMAC logic the SDK verifies
against:

```typescript
import { createHmac } from "node:crypto"

const secret = "whsec_test"
const timestamp = new Date().toISOString()
const payload = JSON.stringify({
  eventId: "evt_test_001",
  object: "event",
  type: "checkout.session.completed",
  schema: "payments-v1",
  createdAt: timestamp,
  livemode: false,
  data: { object: { id: "cs_test", status: "paid" } },
})
const signature = `sha256=${createHmac("sha256", secret)
  .update(`${timestamp}.`)
  .update(payload)
  .digest("hex")}`

const event = client.webhooks.constructEvent(
  payload,
  {
    "PineTree-Signature": signature,
    "PineTree-Timestamp": timestamp,
    "PineTree-Event-Id": "evt_test_001",
    "PineTree-Event-Schema": "payments-v1",
  },
  secret
)
```

For integration tests, use `createSignedWebhookFixture` from
`packages/pinetree-node/test/integration/helpers.ts`.
