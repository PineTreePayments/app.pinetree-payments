# Shopify Integration Setup

## Environment Variables

Add these to your `.env.local` (never commit them):

```
SHOPIFY_CLIENT_ID=<your Shopify app client ID>
SHOPIFY_CLIENT_SECRET=<your Shopify app client secret>
SHOPIFY_APP_URL=https://your-pinetree-domain.com

# 32 bytes as 64 hex characters — used to AES-256-GCM-encrypt stored access tokens.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SHOPIFY_TOKEN_ENCRYPTION_KEY=<64-char hex string>
```

`SHOPIFY_APP_URL` is the public base URL of your PineTree deployment. The
OAuth callback and session endpoints are derived from it:
- `${SHOPIFY_APP_URL}/api/shopify/auth/callback`
- `${SHOPIFY_APP_URL}/api/shopify/webhooks`

---

## Required Shopify Scopes

```
read_orders,write_orders,read_checkouts
```

Set in the Shopify Partner Dashboard under **App setup → API scopes**.

---

## Webhook Topics to Register

Register these in the Shopify Partner Dashboard (or via Admin API after install):

| Topic              | Description                                  |
|--------------------|----------------------------------------------|
| `orders/paid`      | Trigger PineTree session status → paid        |
| `orders/cancelled` | Trigger PineTree session status → cancelled   |
| `orders/updated`   | Sync refund / fulfillment status changes      |
| `app/uninstalled`  | Mark `shopify_connections.status = uninstalled` |

Webhook delivery URL: `${SHOPIFY_APP_URL}/api/shopify/webhooks`

---

## Redirect / Callback URL

Register this in the Shopify Partner Dashboard under **App setup → Allowed redirection URL(s)**:

```
${SHOPIFY_APP_URL}/api/shopify/auth/callback
```

---

## Database Migration

Run the migration before enabling the integration:

```
psql $DATABASE_URL -f database/migrations/20260613_create_shopify_connections.sql
```

---

## Install Flow (merchant)

1. Merchant navigates to:
   ```
   ${SHOPIFY_APP_URL}/api/shopify/auth?shop=<their-shop>.myshopify.com
   ```
2. Shopify shows the authorization screen.
3. On approval, Shopify redirects to the callback URL.
4. PineTree stores the connection and redirects the merchant to
   `/dashboard/developer?shopify=connected`.

---

## Setup Checklist

- [ ] Shopify Partner account created and app registered
- [ ] `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` set in environment
- [ ] `SHOPIFY_APP_URL` set to your public deployment URL
- [ ] `SHOPIFY_TOKEN_ENCRYPTION_KEY` generated and set (64-char hex)
- [ ] Redirect URL registered in Shopify Partner Dashboard
- [ ] Scopes set in Shopify Partner Dashboard
- [ ] Webhook topics registered and pointing to `/api/shopify/webhooks`
- [ ] `20260613_create_shopify_connections.sql` migration applied
- [x] CSRF state cookie implemented in `/api/shopify/auth` + `/api/shopify/auth/callback`
- [x] Token encryption utility ready in `integrations/shopify/lib/crypto.ts`
- [ ] Merchant session lookup wired in `/api/shopify/auth/callback`
- [ ] DB persistence (INSERT shopify_connections) uncommented in callback
- [ ] Webhook handlers wired to PineTree checkout session lookup
- [ ] Merchant API key injection wired in `/api/shopify/session`
