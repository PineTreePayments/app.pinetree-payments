# PineTree Staging Setup

Use a dedicated staging deployment and Supabase project. Do not point local
tests or WooCommerce test stores at production.

## Required application environment

Set these in the staging hosting provider's encrypted environment settings:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database administration |
| `NEXT_PUBLIC_APP_URL` | Public HTTPS staging URL |
| `CHECKOUT_SESSION_SECRET` | Checkout session signing |
| `TERMINAL_SESSION_SECRET` | Terminal session signing |
| `CRON_SECRET` | Protects maintenance routes |

Provider-specific webhook secrets such as `SPEED_WEBHOOK_SECRET`,
`ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA`, and
`ALCHEMY_WEBHOOK_SIGNING_KEY_BASE` are required only when those providers are
enabled in staging.

## PineTree Wallet Dynamic auth

Set `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID` for PineTree Wallet embedded wallet
signing. Dynamic Email fallback is temporary sandbox/dev mode. The production
target is PineTree-issued external JWT/BYOA, where the merchant signs into
PineTree once and Dynamic restores the embedded wallet session from PineTree
auth.

Do not set `NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=false` by itself. That
removes the current Dynamic fallback used to restore the embedded wallet signer
session. Only disable it when `NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE=external_jwt`
is configured end to end and Dynamic has enabled External Authentication/BYOA
for the project with the matching issuer, environment-ID audience, and
JWKS/signing settings.

```bash
NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=...

# Temporary sandbox/dev fallback:
# NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE=dynamic_email_fallback
# NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=true

# Production target after Dynamic BYOA/external JWT is enabled and tested:
NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE=external_jwt
NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=false
DYNAMIC_EXTERNAL_JWT_ENABLED=true
DYNAMIC_EXTERNAL_JWT_ISSUER=https://app.pinetree-payments.com
# Audience is derived from NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID.

# Server-only signing material. Use npm run dynamic:jwt:generate.
# PineTree derives /.well-known/dynamic-jwks.json from this key at runtime.
DYNAMIC_EXTERNAL_JWT_KID=...
DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64=...
```

Full setup guide: [dynamic-external-jwt-setup.md](./dynamic-external-jwt-setup.md).

## Shopify

Set all variables in
[shopify-env-checklist.md](./shopify-env-checklist.md). The public application
URL and Shopify application URL should resolve to the same staging deployment.

## Database migrations

Apply these SQL files to the staging Supabase project in order:

1. `database/migrations/20260612_create_api_idempotency_claims.sql`
2. `database/migrations/20260612_add_webhook_delivery_retry_metadata.sql`
3. `database/migrations/20260613_create_merchant_public_keys.sql`
4. `database/migrations/20260613_create_shopify_connections.sql`

Use the Supabase SQL editor or migration tooling approved for the staging
project. Confirm each table or column exists before starting integration tests.

## Environment verification

From the repository root:

```bash
npm run check:env
npm run check:env:strict
# For an environment injected entirely by the hosting provider:
npm run check:env:production
```

The first command reports all categories without failing for missing values.
Strict mode fails when baseline staging or Shopify variables are missing or
invalid. Neither command prints secret values.

## Safe test sequence

1. Deploy the current commit to staging.
2. Apply the four database migrations.
3. Run `npm run check:env:strict` in the staging build environment.
4. Run `SMOKE_TARGET_URL=https://staging.example.com npm run smoke:staging-routes`.
5. Sign in with a staging merchant and open Developer.
6. Create one secret API key and one public browser key.
7. Configure a staging webhook endpoint and send a test delivery.
8. Run the SDK integration suite with a staging-only API key.
9. Connect a Shopify development store.
10. Install the WooCommerce plugin in a disposable test site.

## Expected results

- Developer loads after authentication.
- Unauthenticated merchant API routes return `401`.
- Shopify shows Not connected before authorization and Connected afterward.
- API keys and webhook deliveries remain scoped to the staging merchant.
- SDK tests create and clean up staging checkout sessions.
- WooCommerce redirects a test order to PineTree Checkout.

## Common failures

- `503` from Shopify auth: one or more Shopify variables are missing.
- Callback state error: the connection was not started from the signed-in
  Developer page, cookies were blocked, or authorization took more than five
  minutes.
- Database errors: a required migration was not applied.
- SDK safety refusal: production URL or credentials were supplied without the
  explicit production override.
- Cron `401`: `CRON_SECRET` is absent or the bearer token does not match.
