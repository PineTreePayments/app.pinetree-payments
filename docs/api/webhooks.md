# Webhooks

PineTree sends signed HTTP POST events to your webhook endpoint when payment, checkout session, or payment link state changes.

## Webhook event model

```typescript
{
  eventId: string
  object: "event"
  type: string
  schema: "payments-v1"
  createdAt: string
  livemode: boolean
  data: {
    object: Record<string, unknown>
  }
}
```

Example:

```json
{
  "eventId": "evt_8f4d9a2c1b0e3f57a6124c90",
  "object": "event",
  "type": "payment.confirmed",
  "schema": "payments-v1",
  "createdAt": "2026-06-16T12:02:30.000Z",
  "livemode": true,
  "data": {
    "object": {
      "id": "pay_01abc",
      "object": "payment",
      "merchantId": "merch_123",
      "amount": 2500,
      "currency": "USD",
      "status": "CONFIRMED",
      "network": "solana",
      "reference": "order_1042",
      "checkoutLinkId": null,
      "confirmedAt": "2026-06-16T12:02:30.000Z",
      "metadata": {}
    }
  }
}
```

Test events use the same envelope with `livemode: false`.

## Webhook headers

Every webhook request includes these current headers:

| Header | Description |
| --- | --- |
| `Content-Type` | `application/json` |
| `PineTree-Signature` | `sha256=<hex>` HMAC-SHA256 digest |
| `PineTree-Timestamp` | ISO 8601 timestamp used for replay protection |
| `PineTree-Event-Id` | Matches `event.eventId` in the body |
| `PineTree-Event-Schema` | `payments-v1` |

PineTree also sends `PineTree-Webhook-Version` (legacy alias for `PineTree-Event-Schema`) and `X-PineTree-Event`, `X-PineTree-Signature`, `X-PineTree-Timestamp` headers for compatibility.

## Signature verification

PineTree signs the exact string:

```text
PineTree-Timestamp + "." + raw_request_body
```

The algorithm is HMAC-SHA256 using the endpoint signing secret. The Node SDK rejects events with timestamps outside a 300 second tolerance window and verifies the `PineTree-Event-Id` and `PineTree-Event-Schema` (or legacy `PineTree-Webhook-Version`) headers when a full header object is passed.

```typescript
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

app.post("/webhooks/pinetree", express.raw({ type: "application/json" }), (req, res) => {
  const event = pinetree.webhooks.constructEvent(
    req.body,
    req.headers as Record<string, string>,
    process.env.PINETREE_WEBHOOK_SECRET!
  )

  if (event.type === "payment.confirmed") {
    fulfillOrder(event.data.object)
  }

  res.json({ received: true })
})
```

Manual verification:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto"

function verifyPineTreeWebhook(
  rawBody: Buffer | string,
  signature: string,
  timestamp: string,
  secret: string
) {
  const age = Math.abs(Date.now() - new Date(timestamp).getTime()) / 1000
  if (age > 300) return false

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest("hex")
  const actual = signature.trim().replace(/^sha256=/i, "")

  const expectedBuffer = Buffer.from(expected, "hex")
  const actualBuffer = Buffer.from(actual, "hex")
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
}
```

## Event types

Supported events:

| Event | Data object |
| --- | --- |
| `payment.created` | payment |
| `payment.pending` | payment |
| `payment.processing` | payment |
| `payment.confirmed` | payment |
| `payment.failed` | payment |
| `payment.expired` | payment |
| `payment.cancelled` | payment |
| `payment.incomplete` | payment |
| `payment.refunded` | payment |
| `checkout.session.created` | checkout.session |
| `checkout.session.processing` | checkout.session |
| `checkout.session.completed` | checkout.session |
| `checkout.session.failed` | checkout.session |
| `checkout.session.expired` | checkout.session |
| `checkout.session.canceled` | checkout.session |
| `payment_link.created` | payment_link |
| `payment_link.disabled` | payment_link |
| `payment_link.expired` | payment_link |

`checkout.session.paid` is accepted as a legacy alias and normalized to `checkout.session.completed`.

## Retry behavior

PineTree retries failed webhook deliveries with these delays, in seconds:

```text
60, 120, 240, 480, 960, 1800, 3600
```

The 3600 second delay is reused after the seventh failed attempt. After attempt 10, the delivery status becomes `dead_letter`, `dead_lettered_at` is set, and no further automatic retry is scheduled. Delivery metadata includes `next_attempt_at`, `last_attempt_at`, `last_status_code`, `last_error`, `delivered_at`, and `dead_lettered_at`.

Use `POST /api/v1/webhook-deliveries/{id}/retry` to manually retry a delivery.

## Security notes

- Verify `PineTree-Signature` before processing an event.
- Use the raw request body bytes. Do not sign `JSON.stringify(req.body)`.
- Reject stale timestamps older than 300 seconds.
- Use `eventId` for idempotent processing.
- Return `2xx` quickly and process longer work asynchronously.
