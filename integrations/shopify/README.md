# PineTree Shopify Integration

**Status: Foundation only — not production-ready.**
The core library, HMAC verification, and route stubs are in place. The TODOs
listed below must be resolved before this integration can be used with a real
Shopify store.

---

## Architecture

```
Merchant browser
  └─ GET /api/shopify/auth?shop=...
        │  validate domain, generate CSRF state, redirect to Shopify
        ▼
Shopify OAuth consent screen
        │  redirect back with code + HMAC
        ▼
  GET /api/shopify/auth/callback
        │  verify HMAC, exchange code for access_token
        │  TODO: persist to shopify_connections (encrypted token)
        │  TODO: verify CSRF state cookie
        └─ redirect to /dashboard/developer?shopify=connected

Customer checkout on Shopify store
  └─ POST /api/shopify/session        (from Shopify payment extension)
        │  validate ShopifyOrderContext, build PineTree session params
        │  TODO: look up merchant from shopify_connections
        └─ POST /api/v1/checkout/sessions  (existing PineTree endpoint)
              └─ returns { sessionId, checkoutUrl }

Shopify webhook events
  └─ POST /api/shopify/webhooks
        │  verify X-Shopify-Hmac-Sha256 (raw body, base64)
        ├─ orders/paid       → TODO: mark PineTree session paid
        ├─ orders/cancelled  → TODO: mark PineTree session cancelled
        ├─ orders/updated    → TODO: sync refund/status changes
        └─ app/uninstalled   → TODO: set shopify_connections.status = 'uninstalled'
```

---

## Files

```
integrations/shopify/
  lib/
    config.ts      — API version, required scopes, webhook topics, env key names
    hmac.ts        — verifyShopifyWebhook (base64), verifyShopifyOAuthCallback (hex)
    oauth.ts       — buildShopifyAuthUrl, buildTokenExchangeBody, isValidShopDomain, generateOAuthState
    session.ts     — ShopifyConnection type, shopAdminBaseUrl, buildAdminApiHeaders
    checkout.ts    — ShopifyOrderContext type, buildPineTreeSessionParams, validateShopifyOrderContext
    crypto.ts      — encryptShopifyToken / decryptShopifyToken (AES-256-GCM)
  test/
    hmac.test.ts      — 13 tests (webhook HMAC + OAuth callback HMAC)
    checkout.test.ts  — 15 tests (buildPineTreeSessionParams + validateShopifyOrderContext)
    oauth.test.ts     — 16 tests (isValidShopDomain + buildShopifyAuthUrl + token exchange + state)
    crypto.test.ts    — 8 tests (encrypt/decrypt round-trips, tamper resistance, missing key)
  README.md  (this file)
  SETUP.md   (environment variables and setup checklist)

app/api/shopify/
  auth/route.ts            — GET: OAuth initiation (CSRF state cookie set here)
  auth/callback/route.ts   — GET: OAuth callback (CSRF state cookie verified here) + token exchange
  webhooks/route.ts        — POST: webhook receiver (HMAC verified; topic dispatch stubs)
  session/route.ts         — POST: create PineTree checkout session from Shopify order (stub)
  disconnect/route.ts      — POST: disconnect a shop (501 stub — needs merchant session + DB)
  status/route.ts          — GET: check connection status (stub — needs DB)

database/migrations/
  20260613_create_shopify_connections.sql
```

---

## Constraints

- PineTree is **not** a native Shopify Payments provider. Integration ships as a
  private/unlisted OAuth app installed via direct URL.
- The Shopify App Store is out of scope until Shopify partner approval is granted.
- PineTree API contracts (`/api/v1/checkout/sessions`, etc.) are unchanged by
  this integration.
- The `access_token` in `shopify_connections` **must** be encrypted at the
  application layer before INSERT/UPDATE. The database stores ciphertext only.

---

## Implementation status

| Item | Status |
|---|---|
| HMAC verification (webhook + OAuth callback) | ✅ Done |
| OAuth initiation with CSRF state cookie | ✅ Done |
| CSRF state cookie verification in callback | ✅ Done |
| Token encryption utility (AES-256-GCM) | ✅ Done |
| Token exchange (code → access_token) | ✅ Done |
| Webhook receiver with topic dispatch | ✅ Done (stubs) |
| DB migration (`shopify_connections`) | ✅ Done (needs to be run) |
| Safe disconnect route | ✅ Done (501 stub) |
| Connection status route | ✅ Done (stub) |
| Merchant session lookup in callback | ❌ TODO — needs PineTree auth wiring |
| Actual DB persistence (INSERT shopify_connections) | ❌ TODO — needs merchant session |
| Token decryption for session creation | ❌ TODO — needs DB persistence |
| Webhook handler bodies | ❌ TODO — needs DB + checkout session lookup |
| Merchant API key injection in /session | ❌ TODO — needs DB persistence |
| Shopify payment extension / storefront | ❌ TODO — separate Shopify-side component |

## Remaining blockers before Private Beta

1. **Merchant session lookup** — `/auth/callback` must identify which PineTree
   merchant is performing the install (via their existing PineTree session) to
   populate `merchant_id` in `shopify_connections`. Set `SHOPIFY_TOKEN_ENCRYPTION_KEY`.
2. **Actual DB persistence** — uncomment the INSERT in `/auth/callback` once
   merchant session is wired and the DB migration has been applied.
3. **Webhook handler bodies** — stub handlers in `webhooks/route.ts` need to
   look up PineTree checkout sessions (by `shopify_order_id`) and update status.
4. **Merchant API key injection** — `/session/route.ts` must fetch the
   merchant's PineTree API key from `shopify_connections` and add it to the
   Authorization header when calling `/api/v1/checkout/sessions`.
5. **Shopify payment extension** — a Shopify checkout extension (or custom
   storefront integration) must POST to `/api/shopify/session` when the customer
   selects PineTree at checkout.
