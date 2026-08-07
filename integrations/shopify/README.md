# PineTree Shopify Integration

PineTree can connect a Shopify store, store its authorization securely, and
process signed Shopify webhooks.

> **Shopify checkout-session creation is currently disabled.**
> `POST /api/shopify/session` returns **410 Gone** and creates nothing. See
> [Checkout session creation is disabled](#checkout-session-creation-is-disabled).

## Merchant-facing flow

- Merchant-scoped Shopify connection status
- Shopify authorization with CSRF and HMAC verification
- Encrypted Shopify token storage
- Safe disconnect and app uninstall handling
- Safe acknowledgement of paid and cancelled order notifications

Shopify order events do not change PineTree payment state. PineTree's signed
payment events remain the source of truth.

## Shopify requirements

A Shopify Partner app is required before install testing with a real store.
PineTree does not submit or publish that app from this repository, and no
storefront or payment extension exists here.

Configure:

```text
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
SHOPIFY_SCOPES
SHOPIFY_APP_URL
SHOPIFY_TOKEN_ENCRYPTION_KEY
```

`SHOPIFY_TOKEN_ENCRYPTION_KEY` must be a 64-character hexadecimal key. Shopify
access tokens are encrypted before they are stored.

## Merchant connection

1. The merchant opens Developer > Integrations and enters a
   `*.myshopify.com` store domain.
2. PineTree creates a short-lived, signed connection context for the signed-in
   merchant.
3. Shopify asks the merchant to authorize the app.
4. PineTree verifies the callback, encrypts the Shopify token, and saves the
   active store connection.
5. The Developer dashboard shows the connected store and allows the merchant
   to disconnect it.

## Checkout session creation is disabled

`POST /api/shopify/session` is **retired**. It returns 410 Gone and performs no
signature parsing, no body read, no connection lookup, no order validation, no
database access, and no checkout-session creation.

**No storefront extension currently calls it.** The storefront or payment
extension that would drive checkout does not exist in this repository and has not
been built or published, so nothing is broken by the route being closed.

**Why it is disabled rather than signed.** Audit finding RA-2 was that the route
had no verification and resolved the merchant from `body.shop`. A Shopify App
Proxy signature was implemented and did close merchant selection, but Shopify
signs the proxied **query string only** — it does not sign app-proxy request
bodies. The order total, currency, order identity, customer email, and
success/cancel URLs would therefore have stayed caller-controlled, and the signed
`timestamp` carries no nonce, so a request could be replayed inside its freshness
window. A verified store identity over an unverified financial payload is not a
production-safe contract for a route that creates checkout sessions.

**Reactivation requires both halves.** A future implementation must verify the
shop identity **and** obtain the authoritative order amount, currency, order
identity, and customer information server-side — by retrieving the order from
Shopify's Admin API with the stored access token, or through another equally
trusted server-side contract. Caller-provided amount, currency, merchant, and
redirect authority are **forbidden**: storefront body values must never decide
what is charged, who is paid, or where the buyer is sent.

Route-level authorization for this endpoint is recorded in
[`docs/security/route-auth-matrix.md`](../../docs/security/route-auth-matrix.md)
(RA-2).

## Webhooks

Shopify webhooks are signature-verified and unaffected by the above. App
uninstall notifications disable the active connection. Order paid and cancelled
notifications are acknowledged without treating Shopify as the payment source of
truth.

## Test-store validation

Before testing with a real store:

1. Create a Shopify Partner app.
2. Configure the callback URL and webhook URL from `SHOPIFY_APP_URL`.
3. Apply the Shopify connections database migration.
4. Configure the required environment variables.
5. Install the app on a development store.

Connection, disconnect, status, and webhook handling can be validated this way.
Checkout cannot: the session endpoint is retired (410) until server-side order
verification exists, so there is no storefront extension step.

See [SETUP.md](./SETUP.md) for configuration details.
