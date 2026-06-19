# Webhook Events

PineTree webhook events use the `payments-v1` event envelope. Each event is delivered as a signed HTTPS `POST` to the merchant webhook endpoint configured in the dashboard.

Use `eventId` for idempotency. Fulfill orders from `payment.confirmed` or `checkout.session.completed`, not from earlier pending or processing events.

## Event catalog

| Event | Description | Object | Trigger |
|---|---|---|---|
| `payment.created` | Payment object was created | `payment` | Checkout/payment engine created a payment |
| `payment.pending` | Payment is waiting for customer or network action | `payment` | Payment entered pending state |
| `payment.processing` | Payment was detected and is awaiting final confirmation | `payment` | Provider/network reports processing |
| `payment.confirmed` | Payment reached final confirmed state | `payment` | Provider/network confirmation |
| `payment.failed` | Payment failed | `payment` | Provider/network/payment attempt failed |
| `payment.expired` | Payment expired | `payment` | Provider or payment window expired |
| `payment.cancelled` | Payment was cancelled | `payment` | Cancelled state emitted by engine or test delivery |
| `payment.incomplete` | Payment was abandoned or could not be completed | `payment` | Stale/abandoned payment marked incomplete |
| `payment.refunded` | Payment was refunded | `payment` | Refunded state emitted by engine or test delivery |
| `checkout.session.created` | Checkout session was created | `checkout.session` | Session creation succeeds |
| `checkout.session.processing` | Checkout session has a processing payment | `checkout.session` | Session aggregate state becomes processing |
| `checkout.session.completed` | Checkout session completed successfully | `checkout.session` | Session aggregate state becomes paid |
| `checkout.session.failed` | Checkout session failed | `checkout.session` | Session aggregate state becomes failed |
| `checkout.session.expired` | Checkout session expired | `checkout.session` | Session lifecycle is expired |
| `checkout.session.canceled` | Checkout session was canceled | `checkout.session` | Session lifecycle is canceled |
| `payment_link.created` | Payment link was created | `payment_link` | Payment link creation succeeds |
| `payment_link.disabled` | Payment link was disabled | `payment_link` | Payment link disabled/archived in implementation |
| `payment_link.expired` | Payment link expired | `payment_link` | Payment link expiration |

Legacy compatibility: `checkout.session.paid` is accepted and normalized to `checkout.session.completed`. It should not be used for new integrations.

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
      "merchantId": "mer_123",
      "amount": 2600,
      "currency": "USD",
      "status": "CONFIRMED",
      "network": "solana",
      "reference": "order_123",
      "checkoutLinkId": "cs_123",
      "confirmedAt": "2026-06-16T00:00:00.000Z",
      "metadata": {}
    }
  }
}
```

## Payment event payload

| Field | Type | Notes |
|---|---|---|
| `id` | string | Payment ID. In live payment events this is the same as `paymentId`. |
| `object` | string | Always `payment`. |
| `merchantId` | string or null | Merchant owner. |
| `amount` | number | Amount in cents for USD payments. |
| `currency` | string | Fiat currency, usually `USD`. |
| `status` | string | Canonical internal status such as `PENDING`, `PROCESSING`, `CONFIRMED`, `FAILED`, `EXPIRED`, or `INCOMPLETE`. |
| `network` | string or null | Rail/network such as `solana`, `base`, `bitcoin_lightning`, or `shift4`. |
| `reference` | string or null | Merchant reference/order ID. |
| `checkoutLinkId` | string or null | Backing checkout session/link ID when present. |
| `confirmedAt` | string or null | ISO timestamp when confirmed, when present. |
| `metadata` | object | Public merchant metadata. |

## Checkout session event payload

Checkout session events contain the public `checkout.session` object.

```json
{
  "eventId": "evt_0123456789abcdef01234567",
  "object": "event",
  "type": "checkout.session.created",
  "schema": "payments-v1",
  "createdAt": "2026-06-16T00:00:00.000Z",
  "livemode": true,
  "data": {
    "object": {
      "id": "cs_123",
      "object": "checkout.session",
      "status": "open",
      "amount": 2600,
      "currency": "USD",
      "reference": "order_123",
      "customer": { "email": "buyer@example.com" },
      "metadata": {},
      "checkoutUrl": "https://app.pinetree-payments.com/checkout/token",
      "paymentId": null,
      "supportedRails": ["solana", "base"],
      "successUrl": "https://example.com/success",
      "cancelUrl": "https://example.com/cancel",
      "createdAt": "2026-06-16T00:00:00.000Z",
      "expiresAt": "2026-06-17T00:00:00.000Z"
    }
  }
}
```

## Event details

### payment.created

Fires when a payment object is created. Object type: `payment`. Retryable: yes. Do not fulfill orders from this event.

### payment.pending

Fires when a payment is waiting for customer or network action. Object type: `payment`. Retryable: yes. Status mapping: visible `Waiting`.

### payment.processing

Fires when payment activity has been detected and PineTree is waiting for final confirmation. Object type: `payment`. Retryable: yes. Status mapping: visible `Processing`.

### payment.confirmed

Fires when a payment reaches the successful terminal state. Object type: `payment`. Retryable: yes. Status mapping: visible `Confirmed`. This is the primary fulfillment event.

### payment.failed

Fires when a provider, network, or payment attempt fails. Object type: `payment`. Retryable: yes. Status mapping: visible `Failed`.

### payment.expired

Fires when a payment expires. Object type: `payment`. Retryable: yes. Status mapping: visible `Expired`.

### payment.cancelled

Fires when a payment is cancelled. Object type: `payment`. Retryable: yes. Status mapping: visible `Incomplete` for dashboard display compatibility.

### payment.incomplete

Fires when a customer abandons, backs out, or no funds are sent before PineTree marks the attempt incomplete. Object type: `payment`. Retryable: yes. Status mapping: visible `Incomplete`.

### payment.refunded

Fires when a payment is refunded. Object type: `payment`. Retryable: yes. Treat as a post-payment adjustment event.

### checkout.session.created

Fires after `POST /api/v1/checkout/sessions` or `POST /api/v1/browser/checkout/sessions` creates a hosted checkout session. Object type: `checkout.session`. Retryable: yes.

### checkout.session.processing

Fires when a session aggregate state becomes `processing`. Object type: `checkout.session`. Retryable: yes.

### checkout.session.completed

Fires when the session aggregate state becomes `paid`. Object type: `checkout.session`. Retryable: yes. This is the canonical replacement for legacy `checkout.session.paid`.

### checkout.session.failed

Fires when the session aggregate state becomes `failed`. Object type: `checkout.session`. Retryable: yes.

### checkout.session.expired

Fires when the session lifecycle is set to `expired`. Object type: `checkout.session`. Retryable: yes.

### checkout.session.canceled

Fires when the session lifecycle is set to `canceled`. Object type: `checkout.session`. Retryable: yes.

### payment_link.created

Fires when a payment link is created. Object type: `payment_link`. Retryable: yes.

### payment_link.disabled

Fires when a payment link is disabled. Object type: `payment_link`. Retryable: yes. PineTree code supports `payment_link.disabled`; `payment_link.archived` is not a supported event type.

### payment_link.expired

Fires when a payment link expires. Object type: `payment_link`. Retryable: yes.
