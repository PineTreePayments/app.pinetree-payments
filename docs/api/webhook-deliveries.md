# Webhook Deliveries

PineTree tracks every attempt to deliver a webhook event to your endpoint. The webhook delivery object captures the delivery status, HTTP response code, attempt count, and any errors. You can list deliveries, inspect failures, and manually retry any delivery.

---

## The WebhookDelivery object

```typescript
{
  id: string                       // "wdel_01abc..."
  object: "webhook.delivery"
  eventType: string                // "payment.confirmed"
  status: WebhookDeliveryStatus    // "pending" | "delivered" | "failed"
  attemptCount: number             // number of delivery attempts so far
  nextAttemptAt: string | null     // ISO 8601 — next scheduled retry
  lastAttemptAt: string | null     // ISO 8601 — most recent attempt
  lastStatusCode: number | null    // HTTP status code from your endpoint
  lastError: string | null         // error description if delivery failed
  deliveredAt: string | null       // ISO 8601 — when delivery succeeded
  createdAt: string                // ISO 8601 — when the delivery was created
}
```

### Delivery statuses

| Status | Description |
|--------|-------------|
| `pending` | Not yet attempted, or queued for retry |
| `delivered` | Your endpoint returned a `2xx` response |
| `failed` | All delivery attempts exhausted without a `2xx` response |

---

## GET /api/v1/webhook-deliveries

List webhook delivery records for your account, most recent first.

**Auth:** `webhooks:read` permission required

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 10 | Number of results (up to 100) |
| `cursor` | string | — | Pagination cursor from `nextCursor` |
| `status` | string | — | Filter by `pending`, `delivered`, or `failed` |
| `eventType` | string | — | Filter by event type (e.g., `payment.confirmed`) |

**Example request:**

```bash
curl "https://app.pinetree-payments.com/api/v1/webhook-deliveries?status=failed&limit=20" \
  -H "Authorization: Bearer pt_live_..."
```

**Example response (200):**

```json
{
  "object": "list",
  "data": [
    {
      "id": "wdel_01abc...",
      "object": "webhook.delivery",
      "eventType": "payment.confirmed",
      "status": "failed",
      "attemptCount": 3,
      "nextAttemptAt": null,
      "lastAttemptAt": "2026-06-16T12:05:00.000Z",
      "lastStatusCode": 500,
      "lastError": "Endpoint returned 500",
      "deliveredAt": null,
      "createdAt": "2026-06-16T12:02:30.000Z"
    }
  ],
  "hasMore": false,
  "nextCursor": null
}
```

---

## POST /api/v1/webhook-deliveries/{id}/retry

Manually trigger a retry of a specific webhook delivery. Useful when your endpoint was temporarily unavailable.

**Auth:** `webhooks:write` permission required

**Request body:** Empty

**Example request:**

```bash
curl -X POST "https://app.pinetree-payments.com/api/v1/webhook-deliveries/wdel_01abc.../retry" \
  -H "Authorization: Bearer pt_live_..."
```

**Example response (200):** Returns the updated `WebhookDelivery` object with the new attempt recorded.

**Errors:**

| Code | Status | Description |
|------|--------|-------------|
| `webhook_delivery_not_found` | 404 | No delivery found for this ID and merchant |
| `missing_permission` | 403 | Key lacks `webhooks:write` |

---

## Node SDK

```typescript
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

// List failed deliveries
const list = await pinetree.webhookDeliveries.list({
  status: "failed",
  limit: 50,
})

// Retry a specific delivery
const delivery = await pinetree.webhookDeliveries.retry("wdel_01abc...")
console.log(delivery.status) // "delivered" if retry succeeded
```

---

## Automatic retry behavior

PineTree automatically retries failed deliveries with exponential backoff. The number of automatic retries and the backoff schedule are managed by the platform and reflected in the `attemptCount` and `nextAttemptAt` fields.

If you need to force a retry immediately (e.g., after fixing your endpoint), use the manual retry route above.

---

## Delivery history in the dashboard

You can also view delivery history, inspect payloads, and manually retry deliveries in **Developer → Webhooks** in the dashboard, without writing any code.
