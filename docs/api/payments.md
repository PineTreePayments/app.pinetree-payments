# Payments

A payment object is created when a customer begins a payment attempt against a checkout session. The payment tracks on-chain status, network, rail, fee, and amount. Payment status updates are delivered to your server via webhooks.

---

## The Payment object

```typescript
{
  id: string                     // "pay_01abc..."
  object: "payment"
  status: string                 // see statuses below
  amount: number                 // merchant amount in cents (USD)
  currency: string               // "USD"
  network: string | null         // "solana" | "base" | "bitcoin_lightning" | ...
  rail: string | null            // public rail label, e.g. "solana" or "base"
  reference: string | null       // your order/reference ID from the checkout session
  metadata: Record<string, unknown>
  createdAt: string              // ISO 8601
  updatedAt: string              // ISO 8601
}
```

---

## Payment statuses

| Status | Description |
|--------|-------------|
| `open` | Payment created, waiting for customer wallet interaction |
| `processing` | Payment broadcast to the network; awaiting confirmation |
| `paid` | Payment confirmed on-chain — order can be fulfilled |
| `failed` | Payment failed (rejected, timed out, or underpaid) |
| `incomplete` | Session expired or payment could not be finalized |

### Status display labels

| Internal status | Dashboard label | Webhook event |
|----------------|-----------------|---------------|
| `open` | Waiting | `payment.created`, `payment.pending` |
| `processing` | Processing | `payment.processing` |
| `paid` | Success | `payment.confirmed` |
| `failed` | Failed | `payment.failed` |
| `incomplete` | Incomplete | `payment.incomplete` |

---

## Payment lifecycle

```
CREATED ──► PENDING ──► PROCESSING ──► CONFIRMED (paid)
                    │                └─► FAILED
                    └──► INCOMPLETE
```

- **CREATED → PENDING**: Checkout session is open and a payment intent has been registered.
- **PENDING → PROCESSING**: Customer wallet has broadcast the transaction to the network.
- **PROCESSING → CONFIRMED**: Transaction is confirmed on-chain. This maps to the `paid` status in the public API.
- **PROCESSING → FAILED**: Transaction was rejected, double-spent, or the provider reported a failure.
- **PENDING → INCOMPLETE**: Session expired before the customer completed payment.

### Terminal states

`paid`, `failed`, and `incomplete` are terminal. Once a payment enters a terminal state, no further transitions are possible.

### Idempotency note

PineTree uses a compare-and-set guard on all state transitions. If two concurrent webhooks arrive and both attempt to move a payment from PROCESSING to CONFIRMED, only one will succeed. The second write is silently dropped — the payment will not be double-confirmed.

---

## GET /api/v1/payments/{id}

Retrieve a payment by its ID.

**Auth:** `payments:read` permission required

**Example request:**

```bash
curl "https://app.pinetree-payments.com/api/v1/payments/pay_01abc..." \
  -H "Authorization: Bearer pt_live_..."
```

**Example response (200):**

```json
{
  "id": "pay_01abc...",
  "object": "payment",
  "status": "paid",
  "amount": 2500,
  "currency": "USD",
  "network": "solana",
  "rail": "solana",
  "reference": "order_1042",
  "metadata": { "productId": "prod_abc" },
  "createdAt": "2026-06-16T12:01:00.000Z",
  "updatedAt": "2026-06-16T12:02:30.000Z"
}
```

**Errors:**

| Code | Status | Description |
|------|--------|-------------|
| `payment_not_found` | 404 | No payment found for this ID and merchant |
| `missing_permission` | 403 | Key lacks `payments:read` |

---

## Fee fields

PineTree charges a flat **$0.15 per transaction** fee. This fee is deducted from the payment amount automatically based on the `feeCaptureMethod` of the active payment rail:

| Method | How fee is captured |
|--------|---------------------|
| `atomic_split` | Fee split at the Solana transaction level for SOL on Solana and USDC on Solana |
| `contract_split` | Fee split via Base ETH smart contract |
| `v7_eip3009_relayer` | Fee split via Base USDC EIP-3009 relayer |
| `invoice_split` | Fee included in the payment invoice (Shift4, Coinbase, Speed) |
| `post_payment_nwc` | Fee collected via separate NWC `pay_invoice` after payment |

The fee is embedded in the payment amount — your gross settlement equals `amount - $0.15`.

---

## Node SDK

```typescript
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

const payment = await pinetree.payments.retrieve("pay_01abc...")
console.log(payment.status)   // "paid"
console.log(payment.network)  // "solana"
console.log(payment.rail)     // "solana"
```

---

## Linking payments to checkout sessions

Every checkout session that receives a payment attempt will have `session.paymentId` set once the payment object is created. Use this to look up the payment directly:

```typescript
const session = await pinetree.checkout.sessions.retrieve("cs_01abc...")

if (session.paymentId) {
  const payment = await pinetree.payments.retrieve(session.paymentId)
  console.log(payment.status)
}
```

For production flows, use webhooks rather than polling — they are lower latency and do not require a separate API call.
