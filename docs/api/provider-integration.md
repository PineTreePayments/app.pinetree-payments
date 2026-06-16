# Provider Integration Guide

This document is for payment processors and infrastructure partners who want to integrate with the PineTree payment platform. PineTree uses a **provider adapter model** — each payment network or processor implements a standard interface that the PineTree Engine calls.

---

## PineTree provider adapter model

Every payment provider in PineTree is represented by a **provider adapter** class that extends `BaseProviderAdapter`. The adapter acts as the bridge between the PineTree Engine and your provider's API.

Each adapter must implement:

```typescript
abstract class BaseProviderAdapter {
  abstract createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  abstract getPaymentStatus(paymentId: string): Promise<PaymentStatus>
  abstract verifyWebhook(rawBody: Buffer, headers: Record<string, string>): boolean
  abstract translateEvent(event: unknown): NormalizedEvent
  abstract healthCheck(): Promise<HealthCheckResult>
}
```

---

## Adapter methods

### `createPayment(input)`

Creates a payment on your system and returns a result containing enough information for the customer to complete payment.

**Input fields:**

| Field | Type | Description |
|-------|------|-------------|
| `paymentId` | string | PineTree internal payment ID |
| `merchantId` | string | Merchant's PineTree account ID |
| `amount` | number | Amount in cents (USD) |
| `currency` | string | Currency code, e.g. `"USD"` |
| `pinetreeFee` | number | PineTree's flat fee ($0.15) |
| `feeCaptureMethod` | string | How the fee is captured (see below) |
| `metadata` | object | Arbitrary metadata from the checkout session |
| `customerEmail` | string \| null | Customer email if provided |
| `reference` | string \| null | Merchant's order reference |

**Result fields:**

| Field | Type | Description |
|-------|------|-------------|
| `providerPaymentId` | string | Your system's payment/invoice identifier |
| `checkoutUrl` | string \| null | URL to redirect customer to, if applicable |
| `qrData` | string \| null | Payment URI or QR content (Lightning, Solana Pay) |
| `expiresAt` | string \| null | ISO 8601 expiry of the payment request |

---

### `getPaymentStatus(providerPaymentId)`

Polls for payment status. Used by the watcher and reconciliation engine for providers that do not deliver webhooks (e.g., polling-only NWC Lightning).

Returns: `"pending" | "paid" | "failed" | "expired"`

---

### `verifyWebhook(rawBody, headers)`

Verifies that an incoming webhook request is authentic. Called by the engine before processing any webhook event from your provider.

**Must use constant-time comparison** (e.g., `crypto.timingSafeEqual`) to prevent timing attacks.

Returns: `boolean` — `true` if the signature is valid.

**Important:** The base class default returns `true` (no verification). In production, all providers must override this method with real HMAC or signature verification.

---

### `translateEvent(event)`

Maps your provider's webhook event structure to PineTree's normalized event format.

```typescript
type NormalizedEvent = {
  type: "payment.confirmed" | "payment.failed" | "payment.pending" | "payment.incomplete"
  paymentId: string     // PineTree payment ID
  providerEventId?: string
}
```

---

### `healthCheck()`

Returns the health status of the provider connection. Called by the payment readiness check endpoint.

```typescript
type HealthCheckResult = {
  status: "healthy" | "degraded" | "unavailable"
  message?: string
}
```

---

## Fee capture methods

PineTree charges a flat **$0.15 per transaction** fee. The adapter declares how this fee is captured:

| Method | Description | Used by |
|--------|-------------|---------|
| `atomic_split` | Fee split at the transaction level in the Solana program | Solana (sol) |
| `contract_split` | Fee split via Base ETH smart contract | Base ETH (base) |
| `v7_eip3009_relayer` | Fee split via EIP-3009 meta-transaction relayer | Base USDC (base-usdc) |
| `invoice_split` | Fee included in the total invoice amount | Shift4, Coinbase Commerce, Speed Lightning |
| `post_payment_nwc` | Fee collected via a separate NWC `pay_invoice` after payment | NWC Lightning |

Declare your fee capture method on the adapter class:

```typescript
class MyProviderAdapter extends BaseProviderAdapter {
  readonly feeCaptureMethod = "invoice_split"
}
```

---

## Webhook requirements

PineTree passes all incoming webhooks from your provider to `verifyWebhook()` before processing. Your integration must:

1. **Sign all webhook deliveries** — use HMAC-SHA256 or equivalent
2. **Provide a signing key or secret** that PineTree stores as an environment variable
3. **Include a timestamp or nonce** in the webhook payload or headers for replay protection
4. **Document the signing algorithm** and header names in your integration spec

### Existing webhook implementations

| Provider | Signature header | Algorithm |
|----------|-----------------|-----------|
| Alchemy (Solana/Base watchers) | `x-alchemy-signature` | HMAC-SHA256 |
| Speed (Lightning) | `svix-signature`, `svix-timestamp`, `svix-id` | Svix-based HMAC |
| Shift4 | `X-Shift4-Signature` | HMAC-SHA256 |

---

## Event normalization

PineTree has a strict internal payment state machine:

```
CREATED → PENDING → PROCESSING → CONFIRMED
                              └→ FAILED
                └→ INCOMPLETE
```

Your `translateEvent()` method must map provider-specific events to these normalized types:

| Your event | PineTree normalized event |
|-----------|--------------------------|
| Payment initiated | `payment.pending` |
| Transaction broadcast | `payment.processing` |
| Transaction confirmed | `payment.confirmed` |
| Transaction failed / rejected | `payment.failed` |
| Payment expired / cancelled | `payment.incomplete` |

**Terminal states are permanent.** Once a payment is `CONFIRMED` or `FAILED`, no further transitions are allowed. The compare-and-set guard in the engine enforces this.

---

## Supported rails

| Rail | Network | Adapter |
|------|---------|---------|
| `sol` | Solana Mainnet | Alchemy watcher + SPL programs |
| `base` | Base (ETH) | Alchemy watcher + split contract |
| `base-usdc` | Base USDC | Alchemy watcher + EIP-3009 relayer |
| `lightning` | Lightning Network | Speed or NWC |
| `coinbase` | Coinbase Commerce | REST API |
| `shift4` | Shift4 Payments | REST API |

---

## Terminal and hardware requirements

For POS terminal integrations, the adapter must:

- Accept POS-originated payment requests (amount, currency, terminal ID)
- Return a payment intent with a QR code or NFC payload the customer can scan
- Support OXXO or similar in-person payment flows if applicable

Relevant fields in `createPayment` input for POS:
- `channel: "pos"` — set in metadata to distinguish terminal payments
- `terminalId` — POS terminal identifier

---

## Settlement and payout

PineTree does not manage custodial wallets for merchants. Funds go directly to merchant-configured wallet addresses (Solana, Base, Lightning). Provide the following to support settlement:

- **Settlement account setup** — how does the merchant connect their wallet or bank account?
- **Split payment support** — does your SDK support atomic fee split at the transaction level?
- **Payout reporting** — can you provide settled amounts per reference/order for reconciliation?
- **Refund support** — does your API support issuing refunds? What is the refund flow?

---

## Sandbox requirements

Before production integration, PineTree requires:

- [ ] Sandbox/testnet credentials provided
- [ ] Sandbox webhook endpoint that delivers real-looking events
- [ ] Documentation of all event types your system can send
- [ ] Signing key / HMAC secret for sandbox webhook verification
- [ ] At least one simulated payment completion and failure event in sandbox

---

## FluidPay — specific questions

1. Does FluidPay support USDC or stablecoin settlement, or only fiat?
2. What is the webhook event model — push (HTTP POST) or pull (polling)?
3. What is the HMAC signing algorithm for webhook verification?
4. Is there a hosted payment page, or does PineTree build the payment UI?
5. What are the onboarding requirements for sub-merchants?
6. Are there per-transaction API rate limits?
7. Does FluidPay support refunds via API?
8. What are the settlement timing and payout schedules?

---

## Shift4 — specific questions

1. Is the Shift4 webhook shared secret configurable per-merchant or global?
2. Does `hosted_payment_url` support dynamic redirect after payment?
3. What is the event lifecycle — do you send events for intermediate states (authorized, captured)?
4. Is there a test/sandbox environment with real-looking webhooks?
5. What fields are required in the `createPayment` request body for card-present vs. card-not-present?
6. Are there ACH or bank transfer options via the Shift4 API?

---

## Mesh — specific questions

1. Does Mesh Connect support direct settlement to merchant wallets, or does it go through Mesh custody?
2. What is the webhook or callback model for completed transfers?
3. Does Mesh support polling as a fallback if webhooks are not delivered?
4. What are the KYC/AML requirements for merchants using Mesh Connect?
5. Is there a managed transfer API (not just Link UI) for server-side payment creation?
6. What networks/assets does Mesh support for settlement? (ETH, SOL, USDC, etc.)
7. What is the fee model for Mesh Connect transfers?

---

## What PineTree needs from a new provider

To complete an integration, provide:

1. **API documentation** — endpoint specs, authentication, error codes
2. **Sandbox credentials** — API key, merchant ID, test account
3. **Webhook documentation** — event types, payload schema, signature algorithm
4. **Signing secret** — for HMAC webhook verification
5. **Settlement model** — how/where funds land for the merchant
6. **Fee model** — fixed, percentage, or combination
7. **Test payment flow** — how to trigger a success, failure, and expiry in sandbox
8. **Refund API** — if supported
9. **Rate limits** — requests per second / day
10. **SLA** — uptime and support contact for escalations
