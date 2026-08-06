# PineTree API

PineTree is a crypto-native payment infrastructure layer. Merchants use the
PineTree API to create checkout sessions, receive payments across enabled rails,
and listen for signed payment events via webhooks.

This page is the entry point and navigation map. Each contract lives in its own
document — this page does not restate them.

---

## Start here

| Step | Document | Read it when |
|---|---|---|
| 1 | [Quickstart](./quickstart.md) | First integration, end to end |
| 2 | [Authentication](./authentication.md) | Wiring credentials |
| 3 | [Checkout Sessions](./checkout-sessions.md) | Creating a payment |
| 4 | [Webhooks](./webhooks.md) | Fulfilling an order reliably |
| 5 | [Go-Live Checklist](./go-live-checklist.md) | Before production traffic |

Base URL for every route:

```text
https://app.pinetree-payments.com
```

PineTree API uses versioned REST endpoints. The current path prefix is
`/api/v1`; a breaking change would use a new prefix. See
[Version Strategy](./version-strategy.md).

---

## Public API scope

These are the public developer routes. They are the only endpoints covered by the
compatibility promise in [Version Strategy](./version-strategy.md). Request and
response schemas are defined machine-readably in
[`openapi.yaml`](./openapi.yaml) — that file, not this page, is authoritative.

| Method | Path | Auth | Scope |
|---|---|---|---|
| `GET` | `/api/v1/checkout/sessions` | Secret API key | `checkout.sessions:read` |
| `POST` | `/api/v1/checkout/sessions` | Secret API key | `checkout.sessions:create` (supports `Idempotency-Key`) |
| `GET` | `/api/v1/checkout/sessions/{id}` | Secret API key | `checkout.sessions:read` or `:create` |
| `POST` | `/api/v1/checkout/sessions/{id}/cancel` | Secret API key | `checkout.sessions:write` or `:create` |
| `POST` | `/api/v1/checkout/sessions/{id}/expire` | Secret API key | `checkout.sessions:write` or `:create` |
| `GET` | `/api/v1/payments/{id}` | Secret API key | `payments:read` |
| `GET` | `/api/v1/webhook-deliveries` | Secret API key | `webhooks:read` |
| `POST` | `/api/v1/webhook-deliveries/{id}/retry` | Secret API key | `webhooks:write` |
| `POST` | `/api/v1/browser/checkout/sessions` | `X-PineTree-Public-Key` | Public key only; no private reads |

---

## Authentication and keys

Secret keys authenticate server-side calls; public keys authenticate browser
checkout creation only. **Never expose a secret key in browser code.**

| Surface | Who uses it | Credential |
|---|---|---|
| REST API (`/api/v1/`) | Merchant servers, server-side integrations | `pt_live_*` secret API key |
| Browser SDK (`/api/v1/browser/`) | Customer-facing web pages | `pk_live_*` public key |
| POS terminal | PineTree POS devices | Terminal PIN / session token |
| Dashboard | Merchant browser sessions | Supabase JWT (cookie) |
| Provider webhooks | Provider-to-PineTree callbacks | Provider signature over the raw body |

- [Authentication](./authentication.md) — header format, key resolution, failure modes.
- [API Keys](./api-keys.md) — key lifecycle, scopes, rotation, revocation.
- [Idempotency](./idempotency.md) — how to make a retried mutation safe.
- [Errors](./errors.md) — the error envelope, types, and codes.

---

## Payments and checkout sessions

A **checkout session** represents one payment intent. Creating it returns a
`checkoutUrl` — a hosted page where the customer pays with their preferred wallet
and network. A session that receives a payment attempt produces a **payment**
object carrying status, network, rail, amount, currency, and metadata.

The **PineTree Engine** is the internal orchestration layer behind these routes:
it owns routing, fee calculation, canonical state transitions, financial posting,
and webhook delivery. It sits between the API routes and the provider adapters.

| Flow | Shape |
|---|---|
| Server-side checkout | Server creates the session, redirects the customer to `checkoutUrl` |
| Browser-side checkout | Browser SDK creates the session with a public key, then opens redirect / popup / embedded mode |
| Webhook fulfillment | Server fulfills on `payment.confirmed` — never on an earlier event |
| Manual retry | Server retries a delivery via `POST /api/v1/webhook-deliveries/{id}/retry` |

- [Checkout Sessions](./checkout-sessions.md) — create, retrieve, list, cancel, expire.
- [Payments](./payments.md) — the payment object and fee capture.
- [Receipts](./receipts.md) — receipt retrieval and download.

---

## Status and lifecycle

Public payment statuses are `open`, `processing`, `paid`, `failed`, `incomplete`,
`expired`, and `canceled`. `paid` maps to PineTree's visible **Confirmed** state.

- [Payment States](./payment-states.md) — how engine states, public API values,
  provider states, and merchant labels map to one another. Read this before
  interpreting any status.

---

## Webhooks and deliveries

PineTree sends signed events to your endpoint when a payment changes state.
Events are signed with HMAC-SHA256 over the raw request body and carry a
timestamp for replay protection.

- [Webhooks](./webhooks.md) — signature headers, HMAC construction, timestamp
  tolerance, verification.
- [Webhook Events](./webhook-events.md) — the supported event catalog and payload
  shapes.
- [Webhook Deliveries](./webhook-deliveries.md) — monitoring delivery and
  retrying a failure.

---

## SDKs

| SDK | Package | Use it for |
|---|---|---|
| Node | `@pinetreepayments/node` | Server: create sessions, retrieve payments, verify webhooks |
| JavaScript | `@pinetreepayments/js` | Browser: open checkout in redirect, popup, or embedded mode |
| React | `@pinetreepayments/react` | React: checkout button and embedded checkout component |

- [SDKs](./sdks.md) — index and version support.
- [Node SDK](./node-sdk.md) · [Browser SDK](./browser-sdk.md) · [React SDK](./react-sdk.md)
- Worked examples: [`examples/`](./examples/rest-create-session.md)

---

## Rails and assets

- [Rails and Assets](./rails-and-assets.md) — the supported rails, the assets on
  each, and which rail identifiers are valid. Restrict what a session accepts by
  passing the `rails` array at creation; asset selection happens in hosted
  checkout.

---

## Testing and release

- [Testing](./testing.md) — test mode and safe fixtures.
- [Go-Live Checklist](./go-live-checklist.md) — the production gate, including the
  readiness criteria referenced by [Version Strategy](./version-strategy.md).
- [Local Stack Release Validation](./local-stack-release-validation.md) — validating
  a release against a local stack.
- [Node SDK Integration Testing](./node-sdk-integration-testing.md) ·
  [React SDK Integration Testing](./react-sdk-integration-testing.md)

---

## Public versus internal routes

Only `/api/v1` routes above are public contracts. Everything else is an internal
application API: it may change without notice and must not be integrated against.
They are listed here so the system is understandable, **not** so they can be used.

| Route family | Classification |
|---|---|
| `/api/checkout/session`, `/api/checkout/stats` | Internal checkout / dashboard |
| `/api/payment-intents/{intentId}/...` | Internal hosted-checkout runtime |
| `/api/payments`, `/api/payments/status`, `/api/payments/{paymentId}/...` | Internal payment runtime |
| `/api/transactions`, `/api/reports/...` | Internal dashboard and reporting |
| `/api/receipts/{paymentId}` | Internal receipt |
| `/api/merchant/api-keys`, `/api/merchant/public-keys`, `/api/merchant/webhooks` | Internal dashboard management |
| `/api/pos/...` | Internal POS (terminal auth) |
| `/api/admin/...` | Admin only |
| `/api/inventory/...`, `/api/shopify/...`, `/api/woocommerce/...` | Internal commerce integrations |
| `/api/cron/...` | Internal maintenance — see [Background Jobs](../architecture.md#background-jobs-authoritative) |
| `/api/debug/...` | Internal/dev only; deliberately excluded from public reference pages |

### Provider webhook intake

Provider callbacks are inbound to PineTree and are **not** merchant webhook
endpoints. Each route pins its own provider identity and verifies a signature over
the raw request body:

`/api/webhooks/base` · `/api/webhooks/bridge` · `/api/webhooks/lightning` ·
`/api/webhooks/moonpay/off-ramp` · `/api/webhooks/shift4` · `/api/webhooks/solana` ·
`/api/webhooks/speed` · `/api/webhooks/stripe`

`/api/webhooks/provider` is **retired and returns 410 Gone.** The generic
provider-selecting endpoint no longer exists; use the dedicated route for your
provider.

---

## Authoritative references

When this page and one of these disagree, the reference below wins — this page is
navigation, not contract.

| Authority | Owns |
|---|---|
| [`openapi.yaml`](./openapi.yaml) | Machine-readable request/response schemas for the public API |
| [`../security/route-auth-matrix.md`](../security/route-auth-matrix.md) | Route-level authorization. Do not infer auth from this page |
| [`../standards/02-lifecycle-and-merchant-status.md`](../standards/02-lifecycle-and-merchant-status.md) | Canonical payment states and the merchant projection |
| [`../standards/05-provider-connectors-events.md`](../standards/05-provider-connectors-events.md) | Provider adapter contract and event processing |
| [`provider-integration.md`](./provider-integration.md) | Adapter model for a partner integrating with PineTree |
| [`partner-api-summary.md`](./partner-api-summary.md) | Partner-facing summary |
| [`../INDEX.md`](../INDEX.md) | The full engineering documentation map |
