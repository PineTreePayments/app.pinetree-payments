# Shopify Setup Guide

## Environment

Add these values to the PineTree deployment:

```text
SHOPIFY_CLIENT_ID=<Shopify app client ID>
SHOPIFY_CLIENT_SECRET=<Shopify app client secret>
SHOPIFY_SCOPES=read_orders,write_orders
SHOPIFY_APP_URL=https://your-pinetree-domain.com
SHOPIFY_TOKEN_ENCRYPTION_KEY=<64-character hexadecimal key>
```

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Shopify app settings

Use these scopes:

```text
read_orders,write_orders
```

Add this allowed callback URL:

```text
${SHOPIFY_APP_URL}/api/shopify/auth/callback
```

Send Shopify webhooks to:

```text
${SHOPIFY_APP_URL}/api/shopify/webhooks
```

Register:

Do not request `read_checkouts`: Shopify retired the legacy Checkout APIs in
2025, and PineTree creates its own checkout sessions.

- `orders/paid`
- `orders/cancelled`
- `orders/updated`
- `app/uninstalled`

## Database

Apply:

```text
database/migrations/20260613_create_shopify_connections.sql
```

The table stores encrypted Shopify authorization tokens and merchant-scoped
connection status.

## Merchant test

1. Sign in to PineTree.
2. Open Developer > Integrations.
3. Enter the development store domain.
4. Select Connect Shopify.
5. Approve the Shopify app installation.
6. Confirm that PineTree shows the store as Connected.
7. Run checkout and webhook tests through the Shopify storefront integration.

The Shopify Partner app and storefront or payment extension must be configured
before this test can complete.
