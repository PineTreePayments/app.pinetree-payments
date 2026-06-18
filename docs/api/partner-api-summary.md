# PineTree Partner API Summary

**Prepared for:** FluidPay, Shift4, Mesh partner conversations  
**Last updated:** 2026-06-16  
**Status:** Production-ready REST API, SDKs published, full test suite passing

---

## What is PineTree?

PineTree is a crypto-native payment infrastructure layer for merchants. It accepts payments across multiple crypto networks and assets (SOL on Solana, USDC on Solana, ETH on Base, USDC on Base, BTC over Lightning, and cards through Shift4 where enabled) and provides:

- A hosted checkout page where customers select a network and complete payment
- A REST API for merchants to create sessions and retrieve payments
- A webhook system for real-time payment event delivery
- A Node SDK and Browser SDK for easy integration
- A merchant dashboard for key management, webhook configuration, and reporting
- A POS terminal for in-person crypto payments

---

## What the PineTree Engine does

The PineTree Engine is the central orchestration layer (not exposed directly to merchants):

- **Payment routing** — selects the appropriate provider/rail based on merchant config
- **Fee calculation** — applies the flat $0.15/transaction fee via the appropriate capture method
- **State machine** — enforces valid payment state transitions (CREATED → PENDING → PROCESSING → CONFIRMED | FAILED | INCOMPLETE)
- **Webhook delivery** — delivers signed events to merchant endpoints after state transitions
- **Ledger writes** — idempotent `upsertLedgerEntry` on every confirmed payment
- **Reconciliation** — maps on-chain transaction status back to payment status
- **Reporting** — aggregates confirmed/failed/incomplete totals per merchant

---

## API groups

| Group | Routes | Purpose |
|-------|--------|---------|
| Checkout Sessions | `POST /api/v1/checkout/sessions` `GET /api/v1/checkout/sessions` `GET /api/v1/checkout/sessions/{id}` `POST .../cancel` `POST .../expire` | Create and manage payment sessions |
| Payments | `GET /api/v1/payments/{id}` | Retrieve payment objects |
| Webhook Deliveries | `GET /api/v1/webhook-deliveries` `POST /api/v1/webhook-deliveries/{id}/retry` | Monitor and retry webhook delivery |
| Browser checkout | `POST /api/v1/browser/checkout/sessions` | Public-key-gated session creation for frontend code |

---

## Supported rails/providers

| Rail | Assets | Fee method | Status |
|------|--------|------------|--------|
| `solana` | SOL on Solana, USDC on Solana | atomic_split | Production |
| `base` | ETH on Base | contract_split | Production |
| `base` | USDC on Base | v7_eip3009_relayer | Production |
| `bitcoin_lightning` | BTC over Lightning (Speed) | invoice_split | Production |
| `bitcoin_lightning` | BTC over Lightning (NWC) | post_payment_nwc | Production |
| `shift4` | Cards where enabled | invoice_split | Production |

---

## Payment lifecycle

```
CREATED → PENDING → PROCESSING → CONFIRMED ("paid")
                             └→ FAILED
              └→ INCOMPLETE
```

State transitions are enforced by a compare-and-set guard — concurrent webhook events cannot double-confirm or double-fail a payment. Terminal states (CONFIRMED, FAILED, INCOMPLETE) are permanent.

---

## Webhook/event model

PineTree delivers HMAC-SHA256 signed events to merchant webhook endpoints.

**Headers:**
- `PineTree-Signature` — HMAC-SHA256 hex digest of `PineTree-Timestamp + "." + raw body`
- `PineTree-Timestamp` — ISO 8601 timestamp (5-minute tolerance window)
- `PineTree-Event-Id` — unique event identifier
- `PineTree-Event-Schema` — `payments-v1` (also sent as `PineTree-Webhook-Version` for legacy compatibility)

**Event types:** `payment.created`, `payment.pending`, `payment.processing`, `payment.confirmed`, `payment.failed`, `payment.expired`, `payment.cancelled`, `payment.incomplete`, `payment.refunded`, `checkout.session.created`, `checkout.session.processing`, `checkout.session.completed`, `checkout.session.failed`, `checkout.session.expired`, `checkout.session.canceled`, `payment_link.created`, `payment_link.disabled`, `payment_link.expired`

**Event shape:**
```json
{
  "eventId": "evt_01abc...",
  "object": "event",
  "type": "payment.confirmed",
  "schema": "payments-v1",
  "createdAt": "2026-06-16T12:02:30.000Z",
  "livemode": true,
  "data": { "object": { "id": "pay_01...", "object": "payment", "status": "CONFIRMED" } }
}
```

---

## Provider adapter requirements

Every provider implements a standard adapter interface:

```
createPayment(input) → { providerPaymentId, checkoutUrl, qrData, expiresAt }
getPaymentStatus(id) → "pending" | "paid" | "failed" | "expired"
verifyWebhook(rawBody, headers) → boolean
translateEvent(event) → NormalizedEvent
healthCheck() → { status, message }
```

PineTree requires:
- HMAC signature on all webhook deliveries
- Sandbox credentials for pre-production testing
- Documentation of all event types and payload schemas
- Settlement model details (wallet addresses, payout timing)

---

## What PineTree needs from a new provider

1. REST API docs + sandbox credentials
2. Webhook event spec (types, payload schema, signing algorithm)
3. Signing secret for webhook HMAC verification
4. Settlement model — do funds go to merchant wallets directly?
5. Fee model — flat fee, percentage, or hybrid?
6. Refund API — supported?
7. Rate limits
8. Uptime SLA and support escalation path
9. Test payment flow — how to trigger success, failure, expiry in sandbox

---

## FluidPay questions

1. Does FluidPay support stablecoin (USDC) settlement or fiat only?
2. Push webhooks or pull polling for payment status?
3. HMAC signing algorithm and header names for webhook verification?
4. Hosted payment page available, or does PineTree provide the UI?
5. Sub-merchant onboarding requirements?
6. API rate limits?
7. Refund API supported?
8. Settlement timing and payout schedule?

---

## Shift4 questions

1. Is the webhook shared secret configurable per-merchant or global?
2. Does `hosted_payment_url` support dynamic return URL?
3. What intermediate events do you send (authorized, captured)?
4. Sandbox environment with real-looking webhooks?
5. Card-present vs. card-not-present required fields?
6. ACH or bank transfer options?

---

## Mesh questions

1. Direct merchant wallet settlement or Mesh custody?
2. Webhook or callback model for completed transfers?
3. Polling fallback if webhooks are not delivered?
4. KYC/AML requirements for merchants?
5. Managed transfer API for server-side payment creation?
6. Supported networks and assets (ETH, SOL, USDC)?
7. Fee model for Mesh Connect transfers?

---

## Current readiness status

| Area | Status |
|------|--------|
| REST API v1 | Production |
| Node SDK (`@pinetreepayments/node`) | Published, v0.1.0 |
| Browser SDK (`@pinetreepayments/js`) | Published, v0.1.0 |
| React SDK (`@pinetreepayments/react`) | Published, v0.1.0 |
| WooCommerce plugin | Published |
| Shopify integration | Production |
| Lint / typecheck / tests / build | All passing |
| Coinbase OAuth | Hardened (HMAC-signed state cookie) |
| Solana, Base, Lightning, Shift4 | Live adapters |
| FluidPay | Integration pending |
| Mesh managed transfers | Deferred |
