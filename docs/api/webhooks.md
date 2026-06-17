# Webhooks

PineTree sends signed HTTP POST events to your webhook endpoint whenever payment status changes. Webhook delivery is asynchronous and separate from the API request that triggered the event.

---

## Webhook event model

```typescript
{
  eventId: string     // "evt_01abc..." — unique event ID
  type: string        // "payment.confirmed" — event type
  createdAt: string   // ISO 8601 — when the event was created
  data: {
    object: Payment   // the resource that changed
  }
}
```

---

## Webhook headers

Every webhook request includes these headers:

| Header | Description |
|--------|-------------|
| `PineTree-Signature` | HMAC-SHA256 hex digest of the raw request body, using your webhook signing secret |
| `PineTree-Timestamp` | ISO 8601 timestamp — used for replay protection |
| `PineTree-Event-Id` | The unique event ID (matches `event.eventId` in the body) |
| `PineTree-Webhook-Version` | Webhook protocol version (currently `2026-06-12`) |
| `Content-Type` | `application/json` |

---

## Signature verification

PineTree signs every webhook using HMAC-SHA256 with your webhook signing secret. You must verify the signature before processing any event. Use the Node SDK's `webhooks.constructEvent()` method, which handles timing, signature comparison, and payload parsing.

**Do not trust events that fail signature verification.**

### Tolerance window

Events with a `PineTree-Timestamp` older than **5 minutes** from the current server time are rejected by the SDK. This prevents replay attacks.

### Node SDK verification (recommended)

```typescript
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

// Express — must receive the raw body, not the parsed JSON
app.post("/webhooks/pinetree", express.raw({ type: "application/json" }), (req, res) => {
  let event
  try {
    event = pinetree.webhooks.constructEvent(
      req.body,                                        // raw Buffer or string
      req.headers as Record<string, string>,           // pass all headers
      process.env.PINETREE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error("Webhook verification failed:", err)
    return res.status(400).send(`Webhook error: ${(err as Error).message}`)
  }

  // event is now verified and typed
  switch (event.type) {
    case "payment.confirmed":
      await fulfillOrder(event.data.object)
      break
    case "payment.failed":
      await handleFailedPayment(event.data.object)
      break
  }

  res.json({ received: true })
})
```

### Manual verification (Node.js without the SDK)

If you prefer not to use the SDK, verify the signature manually:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto"

function verifyPineTreeWebhook(
  rawBody: Buffer | string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  // Check timestamp tolerance (5 minutes)
  const age = Math.abs(Date.now() - new Date(timestamp).getTime()) / 1000
  if (age > 300) return false

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody
  const expected = createHmac("sha256", secret).update(body).digest("hex")
  const actual = signature.trim().replace(/^sha256=/i, "")

  const expectedBuffer = Buffer.from(expected, "hex")
  const actualBuffer   = Buffer.from(actual,   "hex")

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}
```

---

## Event types

### `payment.created`

Fired when a payment object is first created (session receives a payment attempt).

```json
{
  "eventId": "evt_01abc...",
  "type": "payment.created",
  "createdAt": "2026-06-16T12:01:00.000Z",
  "data": {
    "object": {
      "id": "pay_01abc...",
      "object": "payment",
      "status": "open",
      "amount": 2500,
      "currency": "USD",
      "reference": "order_1042"
    }
  }
}
```

### `payment.pending`

Fired when the payment moves to pending state (customer wallet action detected).

```json
{
  "eventId": "evt_01def...",
  "type": "payment.pending",
  "createdAt": "2026-06-16T12:01:30.000Z",
  "data": { "object": { ... } }
}
```

### `payment.processing`

Fired when the transaction is broadcast to the network and awaiting confirmation.

```json
{
  "eventId": "evt_01ghi...",
  "type": "payment.processing",
  "createdAt": "2026-06-16T12:02:00.000Z",
  "data": { "object": { "status": "processing", ... } }
}
```

### `payment.confirmed`

Fired when the transaction is confirmed on-chain. **This is the event to use for order fulfillment.**

```json
{
  "eventId": "evt_01jkl...",
  "type": "payment.confirmed",
  "createdAt": "2026-06-16T12:02:30.000Z",
  "data": {
    "object": {
      "id": "pay_01abc...",
      "object": "payment",
      "status": "paid",
      "amount": 2500,
      "currency": "USD",
      "network": "solana",
      "rail": "solana",
      "reference": "order_1042"
    }
  }
}
```

### `payment.failed`

Fired when the payment fails at the network level.

```json
{
  "eventId": "evt_01mno...",
  "type": "payment.failed",
  "createdAt": "2026-06-16T12:03:00.000Z",
  "data": { "object": { "status": "failed", ... } }
}
```

### `payment.incomplete`

Fired when a payment cannot be finalized (e.g., session expired before the customer completed payment).

```json
{
  "eventId": "evt_01pqr...",
  "type": "payment.incomplete",
  "createdAt": "2026-06-16T12:25:00.000Z",
  "data": { "object": { "status": "incomplete", ... } }
}
```

---

## Retry behavior

PineTree automatically retries failed webhook deliveries with exponential backoff. You can also manually retry any delivery via `POST /api/v1/webhook-deliveries/{id}/retry`.

See [Webhook Deliveries](./webhook-deliveries.md) for retry details and delivery history.

---

## Security notes

- **Always verify the `PineTree-Signature` header** before processing any event.
- **Use `timingSafeEqual`** when comparing signatures to prevent timing attacks. The SDK does this automatically.
- **Reject events with a stale timestamp** (> 5 minutes old). The SDK enforces this automatically.
- **Use HTTPS** for your webhook endpoint.
- **Return `2xx` immediately** and process events asynchronously. If your handler takes longer than the PineTree delivery timeout, the delivery will be retried.
- **Handle duplicate events**: The same event may be delivered more than once due to retry. Use the `eventId` to deduplicate.

---

## Registering your webhook endpoint

1. Go to **Developer → Webhooks** in your dashboard
2. Click **Add endpoint**
3. Enter your HTTPS endpoint URL
4. Copy the signing secret (`whsec_*`) and store it in your environment variables
