# Shopify Environment Checklist

## Required variables

Set these as server-side staging environment variables:

| Variable | Validation |
|---|---|
| `SHOPIFY_CLIENT_ID` | Matches the Shopify Partner app client ID |
| `SHOPIFY_CLIENT_SECRET` | Server-only app secret |
| `SHOPIFY_SCOPES` | Includes `read_orders,write_orders,read_checkouts` |
| `SHOPIFY_APP_URL` | Public HTTPS PineTree staging URL |
| `SHOPIFY_TOKEN_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters |

Do not prefix Shopify secrets with `NEXT_PUBLIC_`. The dashboard receives only
connection state, store domain, and connection timestamps.

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Shopify Partner settings

For `SHOPIFY_APP_URL=https://staging.example.com`, configure:

```text
Allowed callback:
https://staging.example.com/api/shopify/auth/callback

Webhook delivery:
https://staging.example.com/api/shopify/webhooks
```

Register:

- `orders/paid`
- `orders/cancelled`
- `orders/updated`
- `app/uninstalled`

## Verify

```bash
npm run check:env
```

Confirm the Shopify group reports all five variables as present and the
encryption key and URL as valid.

Then:

1. Open Developer > Integrations as a staging merchant.
2. Enter a Shopify development-store domain.
3. Select Connect Shopify.
4. Approve the app installation.
5. Confirm Connected, the store domain, and connection time appear.
6. Disconnect and confirm the card returns to Not connected.

## Safe behavior

- Missing configuration returns a safe `503` response.
- Missing or invalid merchant connection context returns a safe error.
- The callback verifies state and Shopify HMAC before token exchange.
- Shopify tokens are encrypted before database storage.
- Status and disconnect requests are merchant-scoped.
- Shopify order notifications do not override PineTree payment state.

## Common failures

- Invalid redirect URI: the Partner dashboard URL does not exactly match
  `SHOPIFY_APP_URL`.
- Invalid state: browser cookies were blocked or the setup session expired.
- Save failure: the Shopify connections migration or service-role key is
  missing.
- Not connected after approval: inspect server logs for token exchange or
  database errors; never log the returned token.
- Checkout unavailable: the Shopify storefront or payment extension has not
  been installed yet.
