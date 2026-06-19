# Webhook Deliveries

Webhook delivery records let you inspect PineTree's attempts to send signed events to your endpoint and manually retry a delivery.

## WebhookDelivery object

```json
{
  "id": "wdel_123",
  "object": "webhook.delivery",
  "eventType": "payment.confirmed",
  "status": "failed",
  "attemptCount": 2,
  "nextAttemptAt": "2026-06-16T00:05:00.000Z",
  "lastAttemptAt": "2026-06-16T00:02:00.000Z",
  "lastStatusCode": 500,
  "lastError": "HTTP 500",
  "deliveredAt": null,
  "deadLetteredAt": null,
  "createdAt": "2026-06-16T00:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Delivery ID. |
| `object` | string | Always `webhook.delivery`. |
| `eventType` | string | Event type, for example `payment.confirmed`. |
| `status` | string | `pending`, `delivered`, `failed`, or `dead_letter`. |
| `attemptCount` | number | Number of attempted sends. |
| `nextAttemptAt` | string or null | Scheduled retry timestamp, if present. |
| `lastAttemptAt` | string or null | Last send attempt timestamp. |
| `lastStatusCode` | number or null | Last HTTP status from your endpoint. |
| `lastError` | string or null | Last delivery error. |
| `deliveredAt` | string or null | Timestamp of successful delivery. |
| `deadLetteredAt` | string or null | Timestamp when delivery entered dead letter state. |
| `createdAt` | string | Delivery record creation timestamp. |

## List deliveries

`GET /api/v1/webhook-deliveries`

Authentication: secret API key required.

Required scope: `webhooks:read`

Query parameters:

| Parameter | Type | Description |
|---|---|---|
| `limit` | integer | 1 to 100. Defaults to 20 in code. |
| `cursor` | string | Cursor from the previous `nextCursor`. |
| `status` | string | `pending`, `delivered`, `failed`, or `dead_letter`. |
| `eventType` | string | Any supported webhook event type. Legacy `checkout.session.paid` normalizes to `checkout.session.completed`. |

Example response:

```json
{
  "object": "list",
  "data": [
    {
      "id": "wdel_123",
      "object": "webhook.delivery",
      "eventType": "payment.confirmed",
      "status": "delivered",
      "attemptCount": 1,
      "nextAttemptAt": null,
      "lastAttemptAt": "2026-06-16T00:00:02.000Z",
      "lastStatusCode": 200,
      "lastError": null,
      "deliveredAt": "2026-06-16T00:00:02.000Z",
      "deadLetteredAt": null,
      "createdAt": "2026-06-16T00:00:00.000Z"
    }
  ],
  "hasMore": false,
  "nextCursor": null
}
```

## Retry a delivery

`POST /api/v1/webhook-deliveries/{id}/retry`

Authentication: secret API key required.

Required scope: `webhooks:write`

Request body: none.

The retry sends the stored event payload again using the current signing headers. The response is the updated `webhook.delivery` object.

Common errors:

| Code | Meaning |
|---|---|
| `missing_api_key` | No bearer API key was provided. |
| `invalid_api_key` | The key is invalid or revoked. |
| `missing_permission` | The key lacks `webhooks:read` or `webhooks:write`. |
| `invalid_filter` | List filter, cursor, limit, status, or event type is invalid. |
| `webhook_delivery_not_found` | The delivery does not exist for this merchant. |

## Dead letter behavior

Automatic retries use the backoff schedule `60, 120, 240, 480, 960, 1800, 3600` seconds. After attempt 10 fails, PineTree marks the delivery `dead_letter` and sets `deadLetteredAt`.

The public API exposes `deadLetteredAt` and supports the `dead_letter` status. Treat dead-lettered deliveries as requiring operator attention: fix the endpoint, then use manual retry or dashboard tools if the delivery remains retryable.
