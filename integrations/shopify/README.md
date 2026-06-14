# PineTree Shopify Integration

PineTree can connect a Shopify store, store its authorization securely, create
PineTree Checkout sessions for that merchant, and process signed Shopify
webhooks.

## Available now

- Merchant-scoped Shopify connection status
- Shopify authorization with CSRF and HMAC verification
- Encrypted Shopify token storage
- Safe disconnect and app uninstall handling
- PineTree Checkout session creation under the connected merchant
- Safe acknowledgement of paid and cancelled order notifications

Shopify order events do not change PineTree payment state. PineTree's signed
payment events remain the source of truth.

## Shopify requirements

A Shopify Partner app and storefront or payment extension are required before
install testing with a real store. PineTree does not submit or publish that app
from this repository.

Configure:

```text
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
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

## Checkout and webhooks

The Shopify storefront integration sends order details to the Shopify session
endpoint. PineTree verifies that the store has an active connection and creates
a checkout session directly for the connected merchant.

Shopify webhooks are signature-verified. App uninstall notifications disable
the active connection. Order paid and cancelled notifications are acknowledged
without treating Shopify as the payment source of truth.

## Test-store validation

Before testing with a real store:

1. Create a Shopify Partner app.
2. Configure the callback URL and webhook URL from `SHOPIFY_APP_URL`.
3. Apply the Shopify connections database migration.
4. Configure the required environment variables.
5. Install the app on a development store.
6. Add the storefront or payment extension that launches PineTree Checkout.

See [SETUP.md](./SETUP.md) for configuration details.
