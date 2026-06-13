# REST API — Create a Checkout Session

Create a checkout session directly via the REST API without using the Node SDK.

## Authentication

Include your API key as a Bearer token in every request:

```
Authorization: Bearer pt_live_<your-api-key>
```

## Create a session

**`POST /api/v1/checkout/sessions`**

### curl

```bash
curl -X POST https://app.pinetree-payments.com/api/v1/checkout/sessions \
  -H "Authorization: Bearer pt_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 2500,
    "currency": "USD",
    "reference": "order_abc123",
    "successUrl": "https://example.com/success",
    "cancelUrl": "https://example.com/cancel"
  }'
```

### fetch (TypeScript)

```typescript
const response = await fetch(
  "https://app.pinetree-payments.com/api/v1/checkout/sessions",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PINETREE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: 2500,           // $25.00 USD
      currency: "USD",
      reference: "order_abc123",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    }),
  }
)

if (!response.ok) {
  const error = await response.json()
  throw new Error(`PineTree API error: ${error.error?.message}`)
}

const session = await response.json()
// Redirect the customer to session.checkoutUrl
```

## Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | integer | Yes | Amount in smallest currency unit (cents for USD) |
| `currency` | string | No | ISO-4217 code, uppercase. Defaults to `"USD"` |
| `reference` | string | No | Your internal order ID. Returned on the session and payment |
| `customer.email` | string | No | Customer email address |
| `metadata` | object | No | Arbitrary key/value pairs returned as-is |
| `rails` | string[] | No | Restrict to specific payment rails. Omit to accept all |
| `successUrl` | string | No | Redirect URL after successful payment |
| `cancelUrl` | string | No | Redirect URL after cancellation |

## Response

```json
{
  "id": "cs_01j...",
  "object": "checkout.session",
  "status": "open",
  "amount": 2500,
  "currency": "USD",
  "reference": "order_abc123",
  "customer": { "email": null },
  "metadata": {},
  "checkoutUrl": "https://app.pinetree-payments.com/checkout/cs_01j...",
  "paymentId": null,
  "supportedRails": ["solana_usdc", "base_usdc", "base_eth"],
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel",
  "createdAt": "2026-06-12T12:00:00.000Z",
  "expiresAt": "2026-06-12T13:00:00.000Z"
}
```

Redirect the customer to `checkoutUrl` to complete payment.

## Idempotency

Pass an `Idempotency-Key` header to safely retry creation without creating
duplicate sessions:

```bash
curl -X POST https://app.pinetree-payments.com/api/v1/checkout/sessions \
  -H "Authorization: Bearer pt_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order_abc123_attempt_1" \
  -d '{ "amount": 2500, "currency": "USD", "reference": "order_abc123" }'
```

- If the key is reused with identical parameters, the original response is returned.
- If the key is reused with different parameters, the request fails with HTTP 409.
- Keys expire after 24 hours.

## Error responses

All errors follow a consistent shape:

```json
{
  "error": {
    "type": "authentication_error",
    "code": "invalid_api_key",
    "message": "The provided API key is invalid.",
    "requestId": "req_01j..."
  }
}
```

| HTTP status | type | Common cause |
|---|---|---|
| 400 | `invalid_request_error` | Missing required field, invalid amount |
| 401 | `authentication_error` | Missing or invalid API key |
| 403 | `authorization_error` | Key lacks `checkout.sessions:create` permission |
| 409 | `invalid_request_error` | Idempotency key conflict |
| 500 | `api_error` | Internal server error |

## Retrieve a session

```bash
curl https://app.pinetree-payments.com/api/v1/checkout/sessions/cs_01j... \
  -H "Authorization: Bearer pt_live_..."
```

## List sessions

```bash
# All open sessions
curl "https://app.pinetree-payments.com/api/v1/checkout/sessions?status=open&limit=20" \
  -H "Authorization: Bearer pt_live_..."

# By your order reference
curl "https://app.pinetree-payments.com/api/v1/checkout/sessions?reference=order_abc123" \
  -H "Authorization: Bearer pt_live_..."
```

### List query parameters

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `open`, `processing`, `paid`, `failed`, `expired`, `canceled` |
| `reference` | string | Filter by your order reference |
| `limit` | integer | Max results per page (default 20, max 100) |
| `cursor` | string | Pagination cursor from `nextCursor` in the previous response |
| `starting_after` | string | Return sessions created after this session ID |
| `created_after` | string | ISO-8601 lower bound on `createdAt` |
| `created_before` | string | ISO-8601 upper bound on `createdAt` |

### List response

```json
{
  "object": "list",
  "data": [ /* CheckoutSession[] */ ],
  "hasMore": true,
  "nextCursor": "cursor_..."
}
```
