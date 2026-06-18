# Webhook Deliveries

PineTree tracks every webhook delivery attempt. Delivery records expose status, retry metadata, response details, and timestamps for successful or exhausted delivery.

## The WebhookDelivery object

```typescript
{
  id: string
  object: "webhook.delivery"
  eventType: string
  status: "pending" | "delivered" | "failed" | "dead_letter"
  attemptCount: number
  nextAttemptAt: string | null
  lastAttemptAt: string | null
  lastStatusCode: number | null
  lastError: string | null
  deliveredAt: string | null
  deadLetteredAt: string | null
  createdAt: string
}
```

## Delivery statuses

| Status | Description |
| --- | --- |
| `pending` | Queued or not yet attempted |
| `delivered` | Endpoint returned a `2xx` response |
| `failed` | Last attempt failed and another retry may be scheduled |
| `dead_letter` | Attempt 10 failed; no further automatic retry is scheduled |

## GET /api/v1/webhook-deliveries

List webhook delivery records for your account, most recent first.

Auth: `webhooks:read` permission required.

Query parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | integer | 10 | Number of results, up to 100 |
| `cursor` | string | - | Pagination cursor from `nextCursor` |
| `status` | string | - | Filter by `pending`, `delivered`, `failed`, or `dead_letter` |
| `eventType` | string | - | Filter by event type, for example `payment.confirmed` |

```bash
curl "https://app.pinetree-payments.com/api/v1/webhook-deliveries?status=failed&limit=20" \
  -H "Authorization: Bearer pt_live_..."
```

Example response:

```json
{
  "object": "list",
  "data": [
    {
      "id": "wdel_01abc",
      "object": "webhook.delivery",
      "eventType": "payment.confirmed",
      "status": "failed",
      "attemptCount": 3,
      "nextAttemptAt": "2026-06-16T12:13:00.000Z",
      "lastAttemptAt": "2026-06-16T12:05:00.000Z",
      "lastStatusCode": 500,
      "lastError": "HTTP 500",
      "deliveredAt": null,
      "deadLetteredAt": null,
      "createdAt": "2026-06-16T12:02:30.000Z"
    }
  ],
  "hasMore": false,
  "nextCursor": null
}
```

## POST /api/v1/webhook-deliveries/{id}/retry

Manually trigger a retry of a specific webhook delivery.

Auth: `webhooks:write` permission required.

Request body: empty.

```bash
curl -X POST "https://app.pinetree-payments.com/api/v1/webhook-deliveries/wdel_01abc/retry" \
  -H "Authorization: Bearer pt_live_..."
```

The response is the updated `WebhookDelivery` object.

## Automatic retry behavior

PineTree automatically retries failed deliveries with these delays, in seconds:

```text
60, 120, 240, 480, 960, 1800, 3600
```

The 3600 second delay is reused after the seventh failed attempt. After attempt 10 fails, status becomes `dead_letter`, `deadLetteredAt` is set, and `nextAttemptAt` is null.
