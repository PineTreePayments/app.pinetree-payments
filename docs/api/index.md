# PineTree API Reference

PineTree is a crypto-native payment infrastructure layer. Merchants use the PineTree API to create checkout sessions, receive crypto payments across multiple networks, and listen for real-time payment events via webhooks.

---

## What is the PineTree API?

The PineTree API is a REST API that lets you:

- Create and manage **checkout sessions** — hosted payment pages where customers complete a crypto payment
- Retrieve **payment** objects to check status and metadata
- Monitor **webhook deliveries** and retry failed events
- Verify **webhook signatures** to authenticate events sent to your server

The API is versioned (`/api/v1/`) and accepts standard `Authorization: Bearer` headers with API keys.

---

## API vs POS vs Checkout vs Dashboard

| Surface | Who uses it | Auth |
|---------|-------------|------|
| **REST API (`/api/v1/`)** | Merchants, server-side integrations | `pt_live_*` API key |
| **Browser SDK (`/api/v1/browser/`)** | Customer-facing web pages | `pk_live_*` public key |
| **POS Terminal** | Physical PineTree POS devices | Terminal PIN / session token |
| **Dashboard** | Merchant browser sessions | Supabase JWT (cookie) |
| **Webhooks** | Provider-to-PineTree callbacks | Provider HMAC signature |

Your server should use `pt_live_*` secret API keys. Your website or frontend should use `pk_live_*` public keys via the Browser SDK. Never expose secret keys in browser code.

---

## Base URL

```
https://app.pinetree-payments.com
```

All API routes are relative to this base URL.

---

## Versioning

All public API routes are prefixed with `/api/v1/`. Breaking changes will result in a new version prefix (e.g., `/api/v2/`). The current version is `v1`.

---

## Authentication Overview

All `/api/v1/` routes require a secret API key in the `Authorization` header:

```http
Authorization: Bearer pt_live_<your-api-key>
```

API keys have scoped permissions. Each endpoint documents the required permission.

See [Authentication](./authentication.md) for full details.

---

## Core Concepts

### Checkout Session
A checkout session represents a single payment intent. When created, the session generates a `checkoutUrl` — a hosted page where the customer completes the payment using their preferred crypto wallet and network. Sessions expire after 24 hours by default.

### Payment
Every completed (or attempted) checkout session produces a `payment` object. The payment object tracks on-chain status, network, amount, currency, and fee breakdown. Payments transition through states: `open → processing → paid | failed | incomplete`.

### Webhook Event
When a payment changes state, PineTree delivers a signed webhook event to your configured endpoint. Events are signed using HMAC-SHA256 and include a timestamp for replay protection. The PineTree Node SDK includes a `webhooks.constructEvent()` helper for verification.

### PineTree Engine
The PineTree Engine is the internal orchestration layer that handles payment routing, fee calculation, state machine transitions, ledger writes, and webhook delivery. It sits between the API routes and the provider adapters.

---

## Quickstart

See [Quickstart](./quickstart.md) for a step-by-step integration guide.

---

## Supported Payment Flows

| Flow | Description |
|------|-------------|
| **Server-side checkout** | Server creates session, redirects customer to `checkoutUrl` |
| **Browser-side checkout** | Browser SDK creates session with a public key, opens checkout in redirect / popup / embedded mode |
| **Webhook fulfillment** | Server listens for `payment.confirmed` event and fulfills the order |
| **Manual retry** | Server retries a failed webhook delivery via `POST /api/v1/webhook-deliveries/{id}/retry` |

---

## Supported Networks and Assets

PineTree routes payments across multiple crypto networks:

| Rail | Supported assets |
|------------|------------------|
| `solana` | SOL on Solana, USDC on Solana |
| `base` | ETH on Base, USDC on Base |
| `bitcoin_lightning` | BTC over Lightning |
| `lightning` | Alias for `bitcoin_lightning` |
| `shift4` | Cards where enabled |

You can restrict which network rails a session accepts by passing the `rails`
array at session creation. Asset selection happens in the hosted checkout flow.

---

## Error Handling Overview

All API errors return a JSON body with an `error` object:

```json
{
  "error": {
    "type": "authentication_error",
    "code": "missing_api_key",
    "message": "A PineTree API key is required.",
    "requestId": "req_01abc..."
  }
}
```

See [Errors](./errors.md) for the full error reference.

---

## Webhook Overview

PineTree sends signed events to your webhook endpoint when payment status changes. Events use HMAC-SHA256 signatures with a 5-minute tolerance window.

See [Webhooks](./webhooks.md) for headers, verification, and event types.

---

## SDK Overview

| SDK | Package | Use case |
|-----|---------|----------|
| Node SDK | `@pinetreepayments/node` | Server: create sessions, retrieve payments, verify webhooks |
| JavaScript SDK | `@pinetreepayments/js` | Browser: open checkout in redirect, popup, or embedded mode |
| React SDK | `@pinetreepayments/react` | React apps: checkout button and embedded checkout component |

---

## All Documentation

- [Quickstart](./quickstart.md)
- [Authentication](./authentication.md)
- [API Keys](./api-keys.md)
- [Checkout Sessions](./checkout-sessions.md)
- [Payments](./payments.md)
- [Payment States](./payment-states.md)
- [Rails and Assets](./rails-and-assets.md)
- [Webhooks](./webhooks.md)
- [Webhook Events](./webhook-events.md)
- [Webhook Deliveries](./webhook-deliveries.md)
- [SDKs](./sdks.md)
- [Browser SDK](./browser-sdk.md)
- [Node SDK](./node-sdk.md)
- [Errors](./errors.md)
- [Idempotency](./idempotency.md)
- [Testing](./testing.md)
- [Go-Live Checklist](./go-live-checklist.md)
- [Provider Integration](./provider-integration.md)
- [Partner API Summary](./partner-api-summary.md)
- [OpenAPI Spec](./openapi.yaml)
