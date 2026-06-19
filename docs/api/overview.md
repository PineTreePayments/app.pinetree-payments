# API Overview

PineTree provides a versioned REST API for hosted checkout, payment lookup, webhook delivery monitoring, and browser checkout creation.

Base URL:

```text
https://app.pinetree-payments.com
```

Public developer API routes are under `/api/v1`. Dashboard, POS, provider webhook, admin, and checkout runtime routes are internal app APIs and are listed separately so developers can understand the system without treating them as public contracts.

## Public developer API inventory

| Method | Path | Classification | Auth | Scope | Notes |
|---|---|---|---|---|---|
| `GET` | `/api/v1/checkout/sessions` | Public | Secret API key | `checkout.sessions:read` | List sessions. |
| `POST` | `/api/v1/checkout/sessions` | Public | Secret API key | `checkout.sessions:create` | Create hosted checkout session. Supports `Idempotency-Key`. |
| `GET` | `/api/v1/checkout/sessions/{id}` | Public | Secret API key | `checkout.sessions:read` or `checkout.sessions:create` | Retrieve one session. |
| `POST` | `/api/v1/checkout/sessions/{id}/cancel` | Public | Secret API key | `checkout.sessions:write` or `checkout.sessions:create` | Cancel an open session. |
| `POST` | `/api/v1/checkout/sessions/{id}/expire` | Public | Secret API key | `checkout.sessions:write` or `checkout.sessions:create` | Expire an open session. |
| `GET` | `/api/v1/payments/{id}` | Public | Secret API key | `payments:read` | Retrieve payment object. |
| `GET` | `/api/v1/webhook-deliveries` | Public | Secret API key | `webhooks:read` | List webhook deliveries. |
| `POST` | `/api/v1/webhook-deliveries/{id}/retry` | Public | Secret API key | `webhooks:write` | Retry a webhook delivery. |
| `POST` | `/api/v1/browser/checkout/sessions` | Browser public | `X-PineTree-Public-Key` | Public key only | Browser SDK creates checkout session. No private reads. |

## Internal app API inventory

| Route family | Classification | Authentication | Notes |
|---|---|---|---|
| `/api/checkout/session`, `/api/checkout/session/{sessionId}`, `/api/checkout/stats` | Internal checkout/dashboard | Merchant auth or dashboard session depending route | Legacy/unversioned checkout session and dashboard stats paths. |
| `/api/payment-intents/{intentId}`, `/api/payment-intents/{intentId}/select-network`, `/api/payment-intents/{intentId}/cancel` | Internal hosted checkout | Checkout/session context | Creates and updates runtime payment intent selections. |
| `/api/payments`, `/api/payments/create`, `/api/payments/status`, `/api/payments/{paymentId}/...` | Internal payment runtime | Merchant auth, checkout context, or route-specific validation | Payment creation, polling, provider-specific prepare/relay/check routes. |
| `/api/transactions` | Internal dashboard | Dashboard/merchant session | Merchant transaction list. |
| `/api/receipts/{paymentId}`, `/api/receipts/{paymentId}/download` | Internal receipt | Merchant/customer route context | Receipt JSON/download. |
| `/api/merchant/api-keys`, `/api/merchant/api-keys/{id}` | Internal dashboard | Dashboard merchant session | API key management. |
| `/api/merchant/public-keys`, `/api/merchant/public-keys/{id}` | Internal dashboard | Dashboard merchant session | Browser public key management. |
| `/api/merchant/webhooks`, `/api/merchant/webhooks/test`, `/api/merchant/webhook-deliveries` | Internal dashboard | Dashboard merchant session | Webhook settings, test send, delivery log. |
| `/api/pos/...` | Internal POS | Terminal auth/session | POS methods, payments, drawer, terminal session, base session. |
| `/api/webhooks/base`, `/api/webhooks/lightning`, `/api/webhooks/moonpay/off-ramp`, `/api/webhooks/provider`, `/api/webhooks/solana`, `/api/webhooks/speed` | Provider webhook | Provider signatures/secrets per integration | Provider-to-PineTree callbacks. Not merchant webhook endpoints. |
| `/api/admin/...` | Admin | Admin auth | Reporting, transactions, stale payments, support. |
| `/api/reports/...` | Internal dashboard/reporting | Dashboard session | Report generation, PDF, email, download. |
| `/api/inventory/...`, `/api/shopify/...`, `/api/woocommerce/...` | Internal commerce integration | Dashboard/session/provider auth | Inventory and commerce integration flows. |
| `/api/debug/...` | Internal/dev only | Environment or route-specific protections | Debug-only diagnostics. Not public API docs. |
| `/api/cron/...` | Internal scheduled jobs | Cron secret/deployment context | Payment checks, cleanup, stale sweep, balances. |

Debug routes are intentionally not included in public API endpoint reference pages.
