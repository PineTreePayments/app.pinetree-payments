# Checkout Sessions

A checkout session represents a single customer payment intent. Creating a session returns a `checkoutUrl` — a hosted PineTree page where the customer selects a network and completes the payment. Sessions expire after 24 hours.

---

## The CheckoutSession object

```typescript
{
  id: string                    // "cs_01abc..."
  object: "checkout.session"
  status: CheckoutSessionStatus // "open" | "processing" | "paid" | "failed" | "expired" | "canceled"
  amount: number                // amount in smallest currency unit (cents for USD)
  currency: string              // "USD"
  reference: string | null      // your order/reference ID
  customer: {
    email: string | null
  }
  metadata: Record<string, unknown>  // arbitrary key-value data
  checkoutUrl: string           // redirect customers here
  paymentId: string | null      // set when a payment attempt is made
  supportedRails: string[]      // ["solana", "base", "bitcoin_lightning", "shift4"]
  successUrl: string | null     // redirect after successful payment
  cancelUrl: string | null      // redirect after cancellation
  createdAt: string             // ISO 8601
  expiresAt: string | null      // ISO 8601
}
```

### Session statuses

| Status | Description |
|--------|-------------|
| `open` | Session created, waiting for customer payment |
| `processing` | Customer has submitted payment; confirming on-chain |
| `paid` | Payment confirmed — order can be fulfilled |
| `failed` | Payment failed at the network level |
| `expired` | Session expired (after 24h) without a completed payment |
| `canceled` | Merchant explicitly canceled the session |

---

## POST /api/v1/checkout/sessions

Create a new checkout session.

**Auth:** `checkout.sessions:create` permission required

**Headers:**

```http
Authorization: Bearer pt_live_...
Content-Type: application/json
Idempotency-Key: order_1042   (optional — see Idempotency)
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | number | Yes | Amount in smallest currency unit (e.g., cents). Must be > 0. |
| `currency` | string | No | ISO 4217 currency code. Defaults to `"USD"`. |
| `reference` | string | No | Your internal order or reference ID. Returned in webhook events. |
| `customer.email` | string | No | Customer email for receipt or display purposes. |
| `metadata` | object | No | Arbitrary key-value object. Passed through to webhook events. |
| `rails` | string[] | No | Restrict which network rails are offered. Defaults to all configured rails. |
| `successUrl` | string | No | URL to redirect the customer after a successful payment. Must be http/https. |
| `cancelUrl` | string | No | URL to redirect the customer if they cancel. Must be http/https. |

**Example request:**

```bash
curl -X POST https://app.pinetree-payments.com/api/v1/checkout/sessions \
  -H "Authorization: Bearer pt_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order_1042" \
  -d '{
    "amount": 2500,
    "currency": "USD",
    "reference": "order_1042",
    "customer": { "email": "jane@example.com" },
    "metadata": { "productId": "prod_abc" },
    "successUrl": "https://yoursite.com/success",
    "cancelUrl": "https://yoursite.com/cancel"
  }'
```

**Supported assets by rail:**

| Rail value | Assets offered in hosted checkout |
|------------|-----------------------------------|
| `solana` | SOL on Solana, USDC on Solana |
| `base` | ETH on Base, USDC on Base |
| `bitcoin_lightning` | BTC over Lightning |
| `lightning` | Alias for `bitcoin_lightning` |
| `shift4` | Cards where enabled |

The `rails` field restricts the networks shown in hosted checkout. It does not
preselect a token. For example, `rails: ["solana"]` offers both SOL on Solana
and USDC on Solana when those assets are enabled for the merchant.

**Example response (201):**

```json
{
  "id": "cs_01abc123...",
  "object": "checkout.session",
  "status": "open",
  "amount": 2500,
  "currency": "USD",
  "reference": "order_1042",
  "customer": { "email": "jane@example.com" },
  "metadata": { "productId": "prod_abc" },
  "checkoutUrl": "https://app.pinetree-payments.com/pay?token=...",
  "paymentId": null,
  "supportedRails": ["solana", "base", "bitcoin_lightning"],
  "successUrl": "https://yoursite.com/success",
  "cancelUrl": "https://yoursite.com/cancel",
  "createdAt": "2026-06-16T12:00:00.000Z",
  "expiresAt": "2026-06-17T12:00:00.000Z"
}
```

**Common errors:**

| Code | Status | Description |
|------|--------|-------------|
| `missing_api_key` | 401 | No `Authorization` header |
| `invalid_api_key` | 401 | Key not found or revoked |
| `missing_permission` | 403 | Key lacks `checkout.sessions:create` |
| `invalid_amount` | 400 | `amount` is missing, zero, or negative |
| `invalid_customer` | 400 | `customer` is not an object |
| `invalid_metadata` | 400 | `metadata` is not an object |
| `invalid_rails` | 400 | `rails` contains an unsupported rail identifier |
| `idempotency_key_conflict` | 409 | Same `Idempotency-Key` with a different request body |

---

## GET /api/v1/checkout/sessions

List checkout sessions for your merchant account, ordered by creation time descending.

**Auth:** `checkout.sessions:read` permission required

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 10 | Number of results (1–100) |
| `status` | string | — | Filter by status (`open`, `paid`, `failed`, etc.) |
| `reference` | string | — | Filter by your reference/order ID |
| `starting_after` | string | — | Pagination cursor (value of `nextCursor` from previous response) |
| `created_after` | string | — | ISO 8601 date — only return sessions created after this time |
| `created_before` | string | — | ISO 8601 date — only return sessions created before this time |

**Example request:**

```bash
curl "https://app.pinetree-payments.com/api/v1/checkout/sessions?status=paid&limit=20" \
  -H "Authorization: Bearer pt_live_..."
```

**Example response (200):**

```json
{
  "object": "list",
  "data": [
    {
      "id": "cs_01abc...",
      "object": "checkout.session",
      "status": "paid",
      "amount": 2500,
      "currency": "USD",
      "reference": "order_1042",
      ...
    }
  ],
  "hasMore": true,
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTE2..."
}
```

---

## GET /api/v1/checkout/sessions/{id}

Retrieve a single checkout session.

**Auth:** `checkout.sessions:read` or `checkout.sessions:create` permission

**Example request:**

```bash
curl "https://app.pinetree-payments.com/api/v1/checkout/sessions/cs_01abc..." \
  -H "Authorization: Bearer pt_live_..."
```

**Example response (200):**

```json
{
  "id": "cs_01abc...",
  "object": "checkout.session",
  "status": "paid",
  "amount": 2500,
  "currency": "USD",
  "reference": "order_1042",
  "customer": { "email": "jane@example.com" },
  "paymentId": "pay_01xyz...",
  "checkoutUrl": "https://app.pinetree-payments.com/pay?token=...",
  "createdAt": "2026-06-16T12:00:00.000Z",
  "expiresAt": "2026-06-17T12:00:00.000Z"
}
```

**Errors:**

| Code | Status | Description |
|------|--------|-------------|
| `missing_session_id` | 400 | ID param was empty |
| `checkout_session_not_found` | 404 | No session found for this ID and merchant |

---

## POST /api/v1/checkout/sessions/{id}/cancel

Cancel an open checkout session. The session moves to `canceled` status and no further payments can be made against it.

**Auth:** `checkout.sessions:create` or `checkout.sessions:read` permission

**Request body:** Empty

**Example request:**

```bash
curl -X POST "https://app.pinetree-payments.com/api/v1/checkout/sessions/cs_01abc.../cancel" \
  -H "Authorization: Bearer pt_live_..."
```

**Example response (200):** Returns the updated `CheckoutSession` object with `"status": "canceled"`.

**Errors:**

| Code | Status | Description |
|------|--------|-------------|
| `checkout_session_not_found` | 404 | Session not found |
| `checkout_session_not_cancelable` | 400 | Session is already in a terminal state |

---

## POST /api/v1/checkout/sessions/{id}/expire

Expire an open checkout session immediately. The session moves to `expired` status.

**Auth:** `checkout.sessions:create` or `checkout.sessions:read` permission

**Request body:** Empty

**Example request:**

```bash
curl -X POST "https://app.pinetree-payments.com/api/v1/checkout/sessions/cs_01abc.../expire" \
  -H "Authorization: Bearer pt_live_..."
```

**Example response (200):** Returns the updated `CheckoutSession` object with `"status": "expired"`.

---

## Node SDK

```typescript
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

// Create
const session = await pinetree.checkout.sessions.create(
  { amount: 2500, currency: "USD", reference: "order_1042" },
  { idempotencyKey: "order_1042" }
)

// Retrieve
const session = await pinetree.checkout.sessions.retrieve("cs_01abc...")

// List
const list = await pinetree.checkout.sessions.list({
  status: "paid",
  limit: 20,
})

// Cancel
await pinetree.checkout.sessions.cancel("cs_01abc...")

// Expire
await pinetree.checkout.sessions.expire("cs_01abc...")
```
