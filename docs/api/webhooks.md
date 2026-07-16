# Webhooks

PineTree sends signed webhook events to the endpoint configured in the merchant dashboard. Use webhooks for fulfillment and reconciliation instead of polling.

Webhook events are documented in [Webhook Events](./webhook-events.md). Delivery logs and manual retry are documented in [Webhook Deliveries](./webhook-deliveries.md).

## Endpoint configuration

Configure a single HTTPS endpoint in the dashboard under Developer -> Webhooks. The endpoint can subscribe to any implemented event type in `lib/webhooks/events.ts`.

Webhook settings are managed by internal dashboard APIs. Public server integrations can inspect and retry delivery records through `/api/v1/webhook-deliveries`.

## Event envelope

```json
{
  "eventId": "evt_0123456789abcdef01234567",
  "object": "event",
  "type": "payment.confirmed",
  "schema": "payments-v1",
  "createdAt": "2026-06-16T00:00:00.000Z",
  "livemode": true,
  "data": {
    "object": {
      "id": "pay_123",
      "object": "payment",
      "amount": 2600,
      "currency": "USD",
      "status": "CONFIRMED",
      "network": "solana",
      "reference": "order_123",
      "metadata": {}
    }
  }
}
```

## Headers

| Header | Value | Notes |
|---|---|---|
| `PineTree-Signature` | `sha256=<hex>` | Current HMAC-SHA256 signature header. |
| `PineTree-Timestamp` | ISO 8601 timestamp | Used in the signed payload and replay protection. |
| `PineTree-Event-Id` | Event ID | Matches `eventId` in the body. |
| `PineTree-Event-Schema` | `payments-v1` | Current event schema header. |
| `PineTree-Webhook-Version` | `payments-v1` | Legacy schema compatibility header. |
| `X-PineTree-Event` | Event type | Legacy compatibility header. |
| `X-PineTree-Signature` | `sha256=<hex>` | Legacy compatibility signature header. |
| `X-PineTree-Timestamp` | ISO 8601 timestamp | Legacy compatibility timestamp header. |

PineTree signs this exact string:

```text
PineTree-Timestamp + "." + raw_request_body
```

The signing algorithm is HMAC-SHA256 using the endpoint signing secret. The Node SDK enforces a 300 second timestamp tolerance.

## Node verification example

Use the raw request body. Do not parse JSON before verification.

```ts
import express from "express"
import { PineTree } from "@pinetreepayments/node"

const app = express()
const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

app.post(
  "/webhooks/pinetree",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const event = pinetree.webhooks.constructEvent(
      req.body,
      req.headers,
      process.env.PINETREE_WEBHOOK_SECRET!
    )

    if (event.type === "payment.confirmed") {
      const payment = event.data.object
      // Fulfill payment.reference exactly once.
    }

    res.json({ received: true })
  }
)
```

The SDK accepts either the current PineTree headers or the legacy `X-PineTree-*` compatibility headers for signature/timestamp verification. When a full header object is passed, it also validates `PineTree-Event-Id` and `PineTree-Event-Schema` or `PineTree-Webhook-Version`.

## Retry behavior

Each delivery records:

- `status`: `pending`, `delivered`, `failed`, or `dead_letter`
- `attemptCount`
- `lastAttemptAt`
- `nextAttemptAt`
- `lastStatusCode`
- `lastError`
- `deliveredAt`
- `deadLetteredAt`

The delivery worker can retry eligible failed deliveries, and the public API exposes manual retry:

```http
POST /api/v1/webhook-deliveries/{id}/retry
Authorization: Bearer pt_live_...
```

## Idempotent handling

Webhook delivery is at-least-once. Your endpoint should:

- Verify the signature before reading the event.
- Store `eventId` and ignore duplicates.
- Fulfill only terminal success events such as `payment.confirmed` or `checkout.session.completed`.
- Return a 2xx response only after durable processing.
- Treat `payment.failed`, `payment.expired`, `payment.canceled`, and `payment.incomplete` as separate negative terminal cases.

## Event schema compatibility

Current schema: `payments-v1`.

Legacy event type compatibility:

| Legacy event | Current event |
|---|---|
| `checkout.session.paid` | `checkout.session.completed` |

New integrations should subscribe to and handle the current event names listed in [Webhook Events](./webhook-events.md).
