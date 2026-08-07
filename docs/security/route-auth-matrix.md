# PineTree API Route Authentication and Authorization Matrix

## 1. Scope and audit date

- **Audit date:** 2026-08-06
- **Commit audited:** `7653b08` (`main`)
- **Route files:** 254 `app/api/**/route.ts`
- **Exported method handlers:** 310
- **Coverage:** every tracked `app/api/**/route.ts` file and every exported HTTP
  method appears in [§5](#5-complete-route-matrix) exactly once.
- **Remediated since the audit** (all §5 rows and §6 entries reflect the current
  contract):
  - **RA-1** (2026-08-06, Critical) — terminal sessions are issued only to a
    verified merchant who owns the terminal. `POST /api/pos/terminal-auth` is
    retired; `POST /api/pos/terminal-exit-auth` is the PIN boundary.
  - **RA-4** (2026-08-06, High) — the Base POS session route retains its terminal
    claims and enforces merchant and terminal ownership before any service-role
    write.
  - **RA-2** (2026-08-06, High) — `POST /api/shopify/session` is **retired**
    (410). A store-identity signature alone could not make a caller-controlled
    order payload safe, and no storefront extension calls the route.

This audit replaces the 2026-05-19 partial audit, which covered only the 88
routes existing at that date and carried a coverage warning. That warning is
withdrawn: **an absent route is no longer acceptable.** A route that does not
appear here is a defect in this document, not an unaudited route, and
[`__tests__/routeAuthMatrixCoverage.test.ts`](../../__tests__/routeAuthMatrixCoverage.test.ts)
fails the build when one is missing.

**Limits of static analysis.** Every claim below is traced to executable code
and cited by file and line. Static tracing establishes which guard runs and what
identity it derives; it does not prove deployment configuration (environment
variables actually set in production), provider-side behavior, or database
row-level-security policy contents. Items that cannot be settled statically are
listed in [§7](#7-runtime-verification-queue) rather than marked verified.
Nothing here asserts that an exploit was performed.

**How to read a row.** `Authentication` answers *who is calling*.
`Authorization / ownership` answers *may this caller act on this specific
resource*. These are separate columns on purpose: a route can authenticate
perfectly and still authorize nothing. Classification comes from traced code,
never from the route's path — `/api/admin/…`, `/api/internal/…`, and
`/api/webhooks/…` carry no protection by virtue of their names.

## 2. Trust-boundary definitions

| Class | Meaning |
|---|---|
| `PUBLIC` | Intentionally unauthenticated. Authorization, if any, rests on possession of an unguessable identifier, and the response must expose no merchant-private data. |
| `PUBLIC_CAPABILITY` | Unauthenticated, but bearing a scoped capability token (`pco_`) or an unguessable session UUID that the server binds to one resource. |
| `API_KEY` | Merchant API key (`pt_live_`) or public key (`pk_live_`). Scope-checked; resource lookups scoped to the key's merchant. |
| `DASHBOARD_SESSION` | Supabase session JWT (cookie or bearer), or a merchant API key where the route accepts both. Merchant identity is always derived server-side. |
| `ADMIN` | Authenticated **and** `merchants.role == "admin"`. Includes the narrower Shift4-operator boundary (admin **and** a confirmed email match). |
| `TERMINAL_SESSION` | HMAC-signed `pts_` terminal token (24h TTL), or a route that accepts it alongside merchant auth. |
| `PROVIDER_WEBHOOK` | Inbound provider callback. Provider identity is pinned by the route; a signature over the raw body is verified before the payload is trusted. |
| `OAUTH_CALLBACK` | Provider redirect. Merchant identity comes from an HMAC-signed context cookie plus a `state` match — never from the query string. |
| `CRON_INTERNAL` | Scheduler or operator surface behind a shared bearer secret. Authenticates a *caller class*, not a merchant. |
| `DEBUG_NONPRODUCTION` | Guarded by an environment check rather than a credential. |
| `RETIRED` | Handler exists only to return 410 Gone. |

**Results:** `VERIFIED` (guard and ownership traced and adequate) ·
`VERIFIED_PUBLIC` (intentionally public; response and mutation surface checked) ·
`VERIFIED_RETIRED` (410) · `FINDING` (defect, see §6) ·
`RUNTIME_EVIDENCE_REQUIRED` (cannot be settled statically) · `NOT_APPLICABLE`.

A row reads `FINDING` **only when its authentication or authorization is itself
defective**. A route whose auth is sound but which carries a different defect —
information disclosure in an error path, ordering, provider-retry semantics,
non-constant-time secret comparison — keeps its verified result and appends the
finding id (for example `VERIFIED RA-6`). This keeps the auth verdict honest in
both directions: it neither hides a real defect nor implies the guard is broken
when it is not. Every `RA-n` reference in this table resolves in §6.

## 3. Shared authentication helpers

| Helper | File | Authenticates | Authorizes | Fails closed on missing config |
|---|---|---|---|---|
| `requireMerchantAuthFromRequest` / `requireMerchantIdFromRequest` | [`lib/api/merchantAuth.ts:45`](../../lib/api/merchantAuth.ts#L45) | `pt_live_` key (hashed lookup) or Supabase JWT via `getUser` | Returns a merchant id only; no resource scope | Yes — 500 when Supabase env vars are absent |
| `getAdminStatusFromRequest` / `requireAdminFromRequest` | [`lib/api/adminAuth.ts:28`](../../lib/api/adminAuth.ts#L28) | Delegates to merchant auth; **API keys can never be admin** (`source !== "supabase"` → not admin) | `merchants.role == "admin"`; 403 otherwise | Yes — a failed role read yields `isAdmin: false` |
| `requireShift4OperatorFromRequest` | [`lib/api/shift4OperatorAuth.ts:135`](../../lib/api/shift4OperatorAuth.ts#L135) | Admin **and** `verifiedEmail == SHIFT4_OPERATOR_EMAIL` | Operator's own merchant id | Yes — unset var → unauthorized; generic 404 hides which condition failed |
| `requireV1MerchantApiKey(WithAnyPermission)` | [`lib/api/v1/auth.ts:9`](../../lib/api/v1/auth.ts#L9) | `pt_live_` only; JWTs rejected | Scope check → 403; callers scope lookups by merchant id | Yes |
| `requireOnboardingMerchantSession` | [`lib/api/onboardingRoutes.ts:71`](../../lib/api/onboardingRoutes.ts#L71) | Supabase session only; **API key → 403** | Merchant + actor id from the session | Yes |
| `requireTerminalSession` / `verifyTerminalSession` | [`lib/api/terminalAuth.ts:86`](../../lib/api/terminalAuth.ts#L86) | HMAC-SHA256 `pts_` token, 24h TTL, `timingSafeEqual` | Claims carry `mid` + `tid`; **the caller must compare them to the resource** | Yes — throws when `TERMINAL_SESSION_SECRET` is unset; service-role key deliberately excluded from the fallback chain |
| `verifyCheckoutSession` | [`lib/api/checkoutAuth.ts:50`](../../lib/api/checkoutAuth.ts#L50) | HMAC `pco_` token, 24h TTL, `timingSafeEqual` | `claims.iid` must equal the path intent | Yes |
| `requireStripeCardMerchant` | [`lib/api/stripeTerminalAuth.ts:6`](../../lib/api/stripeTerminalAuth.ts#L6) | `pts_` token **or** merchant auth | Returns `{merchantId, terminalId}`; caller must scope | Yes |
| `requireTrustedNativeMerchant` / `isTrustedNativeRequest` | [`lib/api/stripeTerminalAuth.ts:26`](../../lib/api/stripeTerminalAuth.ts#L26) | `PINETREE_NATIVE_CLIENT_SECRET` compared with `timingSafeEqual`, plus merchant/terminal auth | Delegates | Yes — 403 when unset |
| `launchPosTerminalEngine` | [`engine/posTerminalSession.ts`](../../engine/posTerminalSession.ts) | Caller must already be an authenticated merchant | **The only `pts_` minting site.** Requires `terminal.merchant_id` to equal the session-derived merchant id before signing; foreign terminal → 404 | Yes — no merchant id, no signing |
| `verifyPosTerminalExitPinEngine` | [`engine/posTerminalSession.ts`](../../engine/posTerminalSession.ts) | 4-digit PIN vs stored PIN | Authorizes the exit action only; re-checks that the terminal belongs to the session's merchant and **issues no credential** | n/a |
| `verifyHexHmac` | [`lib/webhooks/verifyHexHmac.ts`](../../lib/webhooks/verifyHexHmac.ts) | Validates hex, rejects empty/odd-length, then `timingSafeEqual` | n/a | n/a |
| `processWebhook` verification gate | [`engine/eventProcessor.ts:318`](../../engine/eventProcessor.ts#L318) | Requires the adapter to define `verifyWebhook` and to return **strictly `true`**; a throw is a rejection | Rail correlation after verification | Yes — refuses providers without a verifier |
| `verifyBridgeWebhookSignature` | [`providers/bridge/verifyWebhook.ts:99`](../../providers/bridge/verifyWebhook.ts#L99) | RSA-SHA256 over `timestamp.rawBody`, 10-min tolerance | Owner from stored Bridge ids | Yes — `missing_public_key` |
| `verifyShopifyWebhook` / `verifyShopifyOAuthCallback` | [`integrations/shopify/lib/hmac.ts`](../../integrations/shopify/lib/hmac.ts) | HMAC-SHA256, `timingSafeEqual` inside try/catch | Shop from the verified payload | Yes |
| `getPaymentIntentForMerchant` | [`database/paymentIntents.ts`](../../database/paymentIntents.ts) | n/a | Puts `merchant_id` in the query because the service-role client bypasses RLS; returns null for both a missing and a foreign intent so the id cannot probe existence | n/a |
| `verifyCoinbaseOAuthContext` / `verifyOAuthContext` | `integrations/shopify/lib/oauth.ts`, `lib/oauth/coinbase.ts` | HMAC-signed cookie + `state` equality | Merchant id from the cookie | Yes |
| Internal / cron secret guards | e.g. [`app/api/cron/check-payments/route.ts:4`](../../app/api/cron/check-payments/route.ts#L4) | `Bearer ${CRON_SECRET}` or `${INTERNAL_API_SECRET}` | None beyond the secret | Yes — **all** fail closed when unset (see finding RA-8 on comparison and key separation) |

Two negative results worth recording:

- **No email-only admin path exists.** `isOfficialAdminEmail`
  ([`lib/adminAccess.ts:11`](../../lib/adminAccess.ts#L11)) is referenced by no
  production code — only by a test asserting its absence from the proxy.
  Admin is decided solely by `merchants.role`.
- **No handler trusts a client-supplied merchant id.** Fifteen handlers read a
  `merchantId` from a body or query string; every one is admin-guarded,
  internal-secret-guarded, or uses it only for diagnostics while acting on a
  server-resolved id ([`app/api/wallets/pinetree-profile/route.ts:159`](../../app/api/wallets/pinetree-profile/route.ts#L159)).
  The one exception, finding **RA-2**, selected a merchant from `body.shop`; that
  route is now retired, so no live handler does this.

## 4. Global proxy behavior

[`proxy.ts`](../../proxy.ts) matches `/dashboard/:path*`, `/terminal/:path*`, and
**`/api/:path*`**, so it runs on every API request — but it *rejects* only an
allowlist. Understanding this is essential: **matcher coverage is not
protection.**

| Behavior | Detail |
|---|---|
| Bypassed before any auth work | `/api/solana-pay/*` (wallets send no cookies) and the four wallet-approval routes (`GET`/`PATCH /api/wallets/send-sessions/{id}`, `POST …/complete`, `POST …/refresh-tx`) — [`proxy.ts:71-81`](../../proxy.ts#L71) |
| Rejected with 401 when unauthenticated | Only `/api/admin/`, `/api/dashboard/`, `/api/wallets/`, `/api/reports/` (prefixes) and `/api/transactions`, `/api/providers`, `/api/settings` (exact) — [`proxy.ts:15-25`](../../proxy.ts#L15) |
| Everything else under `/api` | Passes through. `/api/pos/*`, `/api/payments/*`, `/api/internal/*`, `/api/v1/*`, `/api/webhooks/*`, `/api/debug/*`, `/api/checkout/*`, `/api/merchant/*`, `/api/support/*`, `/api/oauth/*`, `/api/shopify/*`, `/api/inventory/*` have **no global protection** and rely entirely on their own guards. |
| Credential interpretation | Supabase cookie session via `getUser()` (never `getSession()`), plus a bearer JWT fallback that explicitly skips `pt_live_` keys — [`proxy.ts:112-129`](../../proxy.ts#L112) |
| Authorization | Only for the `/dashboard/admin` **page** (role read, redirect on failure). The proxy performs **no** authorization for any API route — `/api/admin/` is authenticated defense-in-depth only; the role check lives in the route. |
| Missing config | `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` are non-null-asserted; absent values make session resolution fail, so protected paths reject rather than admit. |
| Prod vs dev | Only cookie `secure` differs. No path becomes less protected in production. |

Because the allowlist is narrow, a new route under an unlisted prefix is
**unprotected until it guards itself**. Findings RA-1, RA-2, and RA-4 all sit on
prefixes the proxy does not cover.

## 5. Complete route matrix

One row per route and exported HTTP method, sorted by path. `State change` marks
whether the handler can write PineTree state.

| Route | Method | Class | Authentication | Authorization / ownership | State change | Evidence | Result |
|---|---|---|---|---|---|---|---|
| `/api/admin/backfill/reconcile-transactions` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/backfill/reconcile-transactions/route.ts:43`](../../app/api/admin/backfill/reconcile-transactions/route.ts#L43) | VERIFIED |
| `/api/admin/business-verification` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/business-verification/route.ts:20`](../../app/api/admin/business-verification/route.ts#L20) | VERIFIED |
| `/api/admin/business-verification` | PATCH | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/business-verification/route.ts:43`](../../app/api/admin/business-verification/route.ts#L43) | VERIFIED |
| `/api/admin/lightning-sweeps` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/lightning-sweeps/route.ts:16`](../../app/api/admin/lightning-sweeps/route.ts#L16) | VERIFIED |
| `/api/admin/lightning-sweeps/[sweepId]` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/lightning-sweeps/[sweepId]/route.ts:11`](../../app/api/admin/lightning-sweeps/[sweepId]/route.ts#L11) | VERIFIED |
| `/api/admin/lightning-sweeps/[sweepId]/cancel` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/lightning-sweeps/[sweepId]/cancel/route.ts:11`](../../app/api/admin/lightning-sweeps/[sweepId]/cancel/route.ts#L11) | VERIFIED |
| `/api/admin/lightning-sweeps/[sweepId]/retry` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/lightning-sweeps/[sweepId]/retry/route.ts:11`](../../app/api/admin/lightning-sweeps/[sweepId]/retry/route.ts#L11) | VERIFIED |
| `/api/admin/me` | GET | DASHBOARD_SESSION | `getAdminStatusFromRequest` (non-throwing) | Reports the caller's own role only | No | [`app/api/admin/me/route.ts:5`](../../app/api/admin/me/route.ts#L5) | VERIFIED |
| `/api/admin/overview` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/overview/route.ts:6`](../../app/api/admin/overview/route.ts#L6) | VERIFIED |
| `/api/admin/provider-onboarding` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/provider-onboarding/route.ts:12`](../../app/api/admin/provider-onboarding/route.ts#L12) | VERIFIED |
| `/api/admin/provider-onboarding` | PATCH | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/provider-onboarding/route.ts:22`](../../app/api/admin/provider-onboarding/route.ts#L22) | VERIFIED |
| `/api/admin/reports` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/reports/route.ts:13`](../../app/api/admin/reports/route.ts#L13) | VERIFIED |
| `/api/admin/shift4/certification` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/shift4/certification/route.ts:10`](../../app/api/admin/shift4/certification/route.ts#L10) | VERIFIED |
| `/api/admin/shift4/onboarding` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/shift4/onboarding/route.ts:8`](../../app/api/admin/shift4/onboarding/route.ts#L8) | VERIFIED |
| `/api/admin/shift4/readiness` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/shift4/readiness/route.ts:9`](../../app/api/admin/shift4/readiness/route.ts#L9) | VERIFIED |
| `/api/admin/speed-credentials` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/speed-credentials/route.ts:16`](../../app/api/admin/speed-credentials/route.ts#L16) | VERIFIED |
| `/api/admin/speed-credentials/[merchantId]/reveal` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/speed-credentials/[merchantId]/reveal/route.ts:28`](../../app/api/admin/speed-credentials/[merchantId]/reveal/route.ts#L28) | VERIFIED |
| `/api/admin/stale-payments` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/stale-payments/route.ts:5`](../../app/api/admin/stale-payments/route.ts#L5) | VERIFIED |
| `/api/admin/stale-payments/mark-incomplete` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/stale-payments/mark-incomplete/route.ts:16`](../../app/api/admin/stale-payments/mark-incomplete/route.ts#L16) | VERIFIED |
| `/api/admin/stale-payments/preview-mark-incomplete` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/stale-payments/preview-mark-incomplete/route.ts:12`](../../app/api/admin/stale-payments/preview-mark-incomplete/route.ts#L12) | VERIFIED |
| `/api/admin/stripe-readiness` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/stripe-readiness/route.ts:6`](../../app/api/admin/stripe-readiness/route.ts#L6) | VERIFIED |
| `/api/admin/support/feedback` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/support/feedback/route.ts:5`](../../app/api/admin/support/feedback/route.ts#L5) | VERIFIED |
| `/api/admin/support/tickets` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/support/tickets/route.ts:5`](../../app/api/admin/support/tickets/route.ts#L5) | VERIFIED |
| `/api/admin/support/tickets/[ticketId]` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/support/tickets/[ticketId]/route.ts:7`](../../app/api/admin/support/tickets/[ticketId]/route.ts#L7) | VERIFIED |
| `/api/admin/support/tickets/[ticketId]/reply` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/support/tickets/[ticketId]/reply/route.ts:22`](../../app/api/admin/support/tickets/[ticketId]/reply/route.ts#L22) | VERIFIED |
| `/api/admin/support/tickets/[ticketId]/status` | PATCH | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/admin/support/tickets/[ticketId]/status/route.ts:7`](../../app/api/admin/support/tickets/[ticketId]/status/route.ts#L7) | VERIFIED |
| `/api/admin/transactions` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/transactions/route.ts:7`](../../app/api/admin/transactions/route.ts#L7) | VERIFIED |
| `/api/admin/transactions/[id]` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/admin/transactions/[id]/route.ts:7`](../../app/api/admin/transactions/[id]/route.ts#L7) | VERIFIED |
| `/api/auth/password-reset` | POST | PUBLIC | None — reset must be reachable unauthenticated | Email-scoped; server-side implicit-flow client; the response does not disclose whether the account exists | Yes | [`app/api/auth/password-reset/route.ts:35`](../../app/api/auth/password-reset/route.ts#L35) | VERIFIED_PUBLIC |
| `/api/checkout-links` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/checkout-links/route.ts:16`](../../app/api/checkout-links/route.ts#L16) | VERIFIED |
| `/api/checkout-links` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/checkout-links/route.ts:29`](../../app/api/checkout-links/route.ts#L29) | VERIFIED |
| `/api/checkout-links/[id]` | PATCH | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/checkout-links/[id]/route.ts:9`](../../app/api/checkout-links/[id]/route.ts#L9) | VERIFIED |
| `/api/checkout/session` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/checkout/session/route.ts:33`](../../app/api/checkout/session/route.ts#L33) | VERIFIED |
| `/api/checkout/session/[sessionId]` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/checkout/session/[sessionId]/route.ts:25`](../../app/api/checkout/session/[sessionId]/route.ts#L25) | VERIFIED |
| `/api/checkout/stats` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/checkout/stats/route.ts:8`](../../app/api/checkout/stats/route.ts#L8) | VERIFIED |
| `/api/cron/check-payments` | GET | CRON_INTERNAL | `Bearer ${CRON_SECRET}` compared with `===`; **fails closed** when unset | None beyond the shared secret | No | [`app/api/cron/check-payments/route.ts:14`](../../app/api/cron/check-payments/route.ts#L14) | VERIFIED RA-8 |
| `/api/cron/cleanup-api-idempotency` | POST | CRON_INTERNAL | `Bearer ${CRON_SECRET}` compared with `===`; **fails closed** when unset | None beyond the shared secret | Yes | [`app/api/cron/cleanup-api-idempotency/route.ts:4`](../../app/api/cron/cleanup-api-idempotency/route.ts#L4) | VERIFIED RA-8 |
| `/api/cron/sweep-stale-payments` | POST | CRON_INTERNAL | `Bearer ${CRON_SECRET}` compared with `===`; **fails closed** when unset | None beyond the shared secret | Yes | [`app/api/cron/sweep-stale-payments/route.ts:24`](../../app/api/cron/sweep-stale-payments/route.ts#L24) | VERIFIED RA-8 |
| `/api/cron/update-balances` | GET | CRON_INTERNAL | `Bearer ${CRON_SECRET}` compared with `===`; **fails closed** when unset | None beyond the shared secret | No | [`app/api/cron/update-balances/route.ts:18`](../../app/api/cron/update-balances/route.ts#L18) | VERIFIED RA-8 |
| `/api/dashboard/overview` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/dashboard/overview/route.ts:16`](../../app/api/dashboard/overview/route.ts#L16) | VERIFIED |
| `/api/debug/base` | POST | DEBUG_NONPRODUCTION | `NODE_ENV === "production"` → 404 (deny-list: an unset NODE_ENV leaves it reachable) | None — log-only sink; returns no data and mutates nothing | No | [`app/api/debug/base/route.ts:3`](../../app/api/debug/base/route.ts#L3) | VERIFIED RA-5 |
| `/api/debug/base-pay-strategy` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/debug/base-pay-strategy/route.ts:203`](../../app/api/debug/base-pay-strategy/route.ts#L203) | VERIFIED |
| `/api/debug/base-pay-strategy` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/debug/base-pay-strategy/route.ts:282`](../../app/api/debug/base-pay-strategy/route.ts#L282) | VERIFIED |
| `/api/debug/base-payment/[paymentId]` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/debug/base-payment/[paymentId]/route.ts:7`](../../app/api/debug/base-payment/[paymentId]/route.ts#L7) | VERIFIED |
| `/api/debug/lightning` | POST | DEBUG_NONPRODUCTION | `NODE_ENV === "production"` → 404 (deny-list: an unset NODE_ENV leaves it reachable) | None — log-only sink; returns no data and mutates nothing | No | [`app/api/debug/lightning/route.ts:3`](../../app/api/debug/lightning/route.ts#L3) | VERIFIED RA-5 |
| `/api/debug/lightning-wallet-strategy` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/debug/lightning-wallet-strategy/route.ts:627`](../../app/api/debug/lightning-wallet-strategy/route.ts#L627) | VERIFIED |
| `/api/debug/lightning-wallet-strategy` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/debug/lightning-wallet-strategy/route.ts:666`](../../app/api/debug/lightning-wallet-strategy/route.ts#L666) | VERIFIED |
| `/api/debug/payment-environment` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/debug/payment-environment/route.ts:45`](../../app/api/debug/payment-environment/route.ts#L45) | VERIFIED |
| `/api/debug/payment-flow-state/[paymentId]` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/debug/payment-flow-state/[paymentId]/route.ts:8`](../../app/api/debug/payment-flow-state/[paymentId]/route.ts#L8) | VERIFIED |
| `/api/debug/pinetree-wallet-auth` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/debug/pinetree-wallet-auth/route.ts:10`](../../app/api/debug/pinetree-wallet-auth/route.ts#L10) | VERIFIED |
| `/api/debug/pinetree-wallet/reset-setup` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/debug/pinetree-wallet/reset-setup/route.ts:28`](../../app/api/debug/pinetree-wallet/reset-setup/route.ts#L28) | VERIFIED |
| `/api/debug/pinetree-wallet/setup-event` | POST | DASHBOARD_SESSION | `requireMerchantAuthFromRequest`; in production only an allowlisted event set is accepted | Merchant id from the session | Yes | [`app/api/debug/pinetree-wallet/setup-event/route.ts:256`](../../app/api/debug/pinetree-wallet/setup-event/route.ts#L256) | VERIFIED |
| `/api/debug/pinetree-wallet/smoke` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/debug/pinetree-wallet/smoke/route.ts:136`](../../app/api/debug/pinetree-wallet/smoke/route.ts#L136) | VERIFIED |
| `/api/debug/solana` | POST | DEBUG_NONPRODUCTION | `NODE_ENV === "production"` → 404 (deny-list: an unset NODE_ENV leaves it reachable) | None — log-only sink; returns no data and mutates nothing | No | [`app/api/debug/solana/route.ts:3`](../../app/api/debug/solana/route.ts#L3) | VERIFIED RA-5 |
| `/api/debug/solana-wallet-strategy` | GET | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | No | [`app/api/debug/solana-wallet-strategy/route.ts:552`](../../app/api/debug/solana-wallet-strategy/route.ts#L552) | VERIFIED |
| `/api/debug/solana-wallet-strategy` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/debug/solana-wallet-strategy/route.ts:592`](../../app/api/debug/solana-wallet-strategy/route.ts#L592) | VERIFIED |
| `/api/debug/solflare` | POST | DEBUG_NONPRODUCTION | `NODE_ENV === "production"` → 404 (deny-list: an unset NODE_ENV leaves it reachable) | None — log-only sink; returns no data and mutates nothing | No | [`app/api/debug/solflare/route.ts:3`](../../app/api/debug/solflare/route.ts#L3) | VERIFIED RA-5 |
| `/api/help/assistant` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/help/assistant/route.ts:29`](../../app/api/help/assistant/route.ts#L29) | VERIFIED |
| `/api/help/assistant/context-debug` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/help/assistant/context-debug/route.ts:22`](../../app/api/help/assistant/context-debug/route.ts#L22) | VERIFIED |
| `/api/internal/base-payments/[paymentId]/reconcile` | POST | CRON_INTERNAL | `Bearer` of `CRON_SECRET` **or** `INTERNAL_API_SECRET`; fails closed when both unset | None beyond the shared secret | Yes | [`app/api/internal/base-payments/[paymentId]/reconcile/route.ts:19`](../../app/api/internal/base-payments/[paymentId]/reconcile/route.ts#L19) | VERIFIED |
| `/api/internal/lightning-payouts/process` | POST | CRON_INTERNAL | `Bearer` of `CRON_SECRET` **or** `INTERNAL_API_SECRET`; fails closed when both unset | None beyond the shared secret | Yes | [`app/api/internal/lightning-payouts/process/route.ts:13`](../../app/api/internal/lightning-payouts/process/route.ts#L13) | VERIFIED |
| `/api/internal/lightning-settlement-payouts/process` | POST | CRON_INTERNAL | `Bearer ${INTERNAL_API_SECRET}`; fails closed when unset | None beyond the shared secret | Yes | [`app/api/internal/lightning-settlement-payouts/process/route.ts:13`](../../app/api/internal/lightning-settlement-payouts/process/route.ts#L13) | VERIFIED |
| `/api/internal/lightning/speed/status` | GET | CRON_INTERNAL | `Bearer` of `CRON_SECRET` **or** `INTERNAL_API_SECRET`; fails closed when both unset | None beyond the shared secret | No | [`app/api/internal/lightning/speed/status/route.ts:32`](../../app/api/internal/lightning/speed/status/route.ts#L32) | VERIFIED |
| `/api/internal/shift4/attempts` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/internal/shift4/attempts/route.ts:8`](../../app/api/internal/shift4/attempts/route.ts#L8) | VERIFIED |
| `/api/internal/shift4/connect` | GET | ADMIN | `requireShift4OperatorFromRequest` (admin **and** confirmed email == `SHIFT4_OPERATOR_EMAIL`) | Operator's own merchant id; generic 404 on any failure | No | [`app/api/internal/shift4/connect/route.ts:155`](../../app/api/internal/shift4/connect/route.ts#L155) | VERIFIED |
| `/api/internal/shift4/connect` | POST | ADMIN | `requireShift4OperatorFromRequest` (admin **and** confirmed email == `SHIFT4_OPERATOR_EMAIL`) | Operator's own merchant id; generic 404 on any failure | Yes | [`app/api/internal/shift4/connect/route.ts:164`](../../app/api/internal/shift4/connect/route.ts#L164) | VERIFIED |
| `/api/internal/shift4/invoices/[invoice]` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/internal/shift4/invoices/[invoice]/route.ts:8`](../../app/api/internal/shift4/invoices/[invoice]/route.ts#L8) | VERIFIED |
| `/api/internal/shift4/merchant` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/internal/shift4/merchant/route.ts:8`](../../app/api/internal/shift4/merchant/route.ts#L8) | VERIFIED |
| `/api/internal/shift4/onboarding/fixture-update` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/internal/shift4/onboarding/fixture-update/route.ts:9`](../../app/api/internal/shift4/onboarding/fixture-update/route.ts#L9) | VERIFIED |
| `/api/internal/shift4/onboarding/start` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/internal/shift4/onboarding/start/route.ts:8`](../../app/api/internal/shift4/onboarding/start/route.ts#L8) | VERIFIED |
| `/api/internal/shift4/onboarding/status` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/internal/shift4/onboarding/status/route.ts:7`](../../app/api/internal/shift4/onboarding/status/route.ts#L7) | VERIFIED |
| `/api/internal/shift4/payments/[operation]` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/internal/shift4/payments/[operation]/route.ts:9`](../../app/api/internal/shift4/payments/[operation]/route.ts#L9) | VERIFIED |
| `/api/internal/shift4/readiness` | GET | ADMIN | `requireShift4OperatorFromRequest` (admin **and** confirmed email == `SHIFT4_OPERATOR_EMAIL`) | Operator's own merchant id; generic 404 on any failure | No | [`app/api/internal/shift4/readiness/route.ts:18`](../../app/api/internal/shift4/readiness/route.ts#L18) | VERIFIED |
| `/api/internal/shift4/recovery` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/internal/shift4/recovery/route.ts:8`](../../app/api/internal/shift4/recovery/route.ts#L8) | VERIFIED |
| `/api/internal/shift4/retail-terminal` | GET | ADMIN | `requireShift4OperatorFromRequest` (admin **and** confirmed email == `SHIFT4_OPERATOR_EMAIL`) | Operator's own merchant id; generic 404 on any failure | No | [`app/api/internal/shift4/retail-terminal/route.ts:146`](../../app/api/internal/shift4/retail-terminal/route.ts#L146) | VERIFIED |
| `/api/internal/shift4/retail-terminal` | POST | ADMIN | `requireShift4OperatorFromRequest` (admin **and** confirmed email == `SHIFT4_OPERATOR_EMAIL`) | Operator's own merchant id; generic 404 on any failure | Yes | [`app/api/internal/shift4/retail-terminal/route.ts:179`](../../app/api/internal/shift4/retail-terminal/route.ts#L179) | VERIFIED |
| `/api/internal/shift4/retail-terminal/verification` | POST | ADMIN | `requireShift4OperatorFromRequest` (admin **and** confirmed email == `SHIFT4_OPERATOR_EMAIL`) | Operator's own merchant id; generic 404 on any failure | Yes | [`app/api/internal/shift4/retail-terminal/verification/route.ts:120`](../../app/api/internal/shift4/retail-terminal/verification/route.ts#L120) | VERIFIED |
| `/api/internal/shift4/retail-verification` | POST | ADMIN | `requireShift4OperatorFromRequest` (admin **and** confirmed email == `SHIFT4_OPERATOR_EMAIL`) | Operator's own merchant id; generic 404 on any failure | Yes | [`app/api/internal/shift4/retail-verification/route.ts:101`](../../app/api/internal/shift4/retail-verification/route.ts#L101) | VERIFIED |
| `/api/internal/shift4/tenders` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/internal/shift4/tenders/route.ts:8`](../../app/api/internal/shift4/tenders/route.ts#L8) | VERIFIED |
| `/api/internal/shift4/tokenization/complete` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/internal/shift4/tokenization/complete/route.ts:8`](../../app/api/internal/shift4/tokenization/complete/route.ts#L8) | VERIFIED |
| `/api/internal/shift4/tokenization/sessions` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/internal/shift4/tokenization/sessions/route.ts:8`](../../app/api/internal/shift4/tokenization/sessions/route.ts#L8) | VERIFIED |
| `/api/internal/speed/capabilities` | GET | CRON_INTERNAL | `Bearer` of `CRON_SECRET` **or** `INTERNAL_API_SECRET`; fails closed when both unset | None beyond the shared secret | No | [`app/api/internal/speed/capabilities/route.ts:22`](../../app/api/internal/speed/capabilities/route.ts#L22) | VERIFIED |
| `/api/internal/speed/custom-connect` | POST | CRON_INTERNAL | `Bearer` of `CRON_SECRET` **or** `INTERNAL_API_SECRET`; fails closed when both unset | None beyond the shared secret | Yes | [`app/api/internal/speed/custom-connect/route.ts:22`](../../app/api/internal/speed/custom-connect/route.ts#L22) | VERIFIED |
| `/api/internal/wallets/pinetree/btc-address` | POST | CRON_INTERNAL | `Bearer ${INTERNAL_API_SECRET}`; fails closed when unset | None beyond the shared secret | Yes | [`app/api/internal/wallets/pinetree/btc-address/route.ts:27`](../../app/api/internal/wallets/pinetree/btc-address/route.ts#L27) | VERIFIED |
| `/api/internal/wallets/pinetree/debug-profile` | GET | CRON_INTERNAL | `Bearer ${INTERNAL_API_SECRET}`; fails closed when unset | None beyond the shared secret | No | [`app/api/internal/wallets/pinetree/debug-profile/route.ts:12`](../../app/api/internal/wallets/pinetree/debug-profile/route.ts#L12) | VERIFIED |
| `/api/internal/wallets/pinetree/reconcile-withdrawals` | POST | CRON_INTERNAL | `Bearer` of `CRON_SECRET` or `INTERNAL_API_SECRET`, `===`; fails closed when unset | None — an optional `body.merchantId` lets the secret holder target any merchant (operator tool) | Yes | [`app/api/internal/wallets/pinetree/reconcile-withdrawals/route.ts:13`](../../app/api/internal/wallets/pinetree/reconcile-withdrawals/route.ts#L13) | VERIFIED RA-8 |
| `/api/inventory` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/inventory/route.ts:15`](../../app/api/inventory/route.ts#L15) | VERIFIED |
| `/api/inventory` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/inventory/route.ts:24`](../../app/api/inventory/route.ts#L24) | VERIFIED |
| `/api/inventory/[id]` | PATCH | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/inventory/[id]/route.ts:15`](../../app/api/inventory/[id]/route.ts#L15) | VERIFIED |
| `/api/inventory/[id]` | DELETE | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/inventory/[id]/route.ts:35`](../../app/api/inventory/[id]/route.ts#L35) | VERIFIED |
| `/api/inventory/import` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/inventory/import/route.ts:7`](../../app/api/inventory/import/route.ts#L7) | VERIFIED |
| `/api/inventory/integrations` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/inventory/integrations/route.ts:5`](../../app/api/inventory/integrations/route.ts#L5) | VERIFIED |
| `/api/inventory/integrations/[provider]/connect` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/inventory/integrations/[provider]/connect/route.ts:5`](../../app/api/inventory/integrations/[provider]/connect/route.ts#L5) | VERIFIED |
| `/api/inventory/integrations/[provider]/disconnect` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/inventory/integrations/[provider]/disconnect/route.ts:5`](../../app/api/inventory/integrations/[provider]/disconnect/route.ts#L5) | VERIFIED |
| `/api/inventory/integrations/[provider]/sync` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/inventory/integrations/[provider]/sync/route.ts:5`](../../app/api/inventory/integrations/[provider]/sync/route.ts#L5) | VERIFIED |
| `/api/merchant/api-keys` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/merchant/api-keys/route.ts:5`](../../app/api/merchant/api-keys/route.ts#L5) | VERIFIED |
| `/api/merchant/api-keys` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/api-keys/route.ts:23`](../../app/api/merchant/api-keys/route.ts#L23) | VERIFIED |
| `/api/merchant/api-keys/[id]` | DELETE | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/api-keys/[id]/route.ts:5`](../../app/api/merchant/api-keys/[id]/route.ts#L5) | VERIFIED |
| `/api/merchant/business-owner-profile` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/merchant/business-owner-profile/route.ts:10`](../../app/api/merchant/business-owner-profile/route.ts#L10) | VERIFIED |
| `/api/merchant/business-owner-profile` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/business-owner-profile/route.ts:24`](../../app/api/merchant/business-owner-profile/route.ts#L24) | VERIFIED |
| `/api/merchant/business-profile` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/merchant/business-profile/route.ts:13`](../../app/api/merchant/business-profile/route.ts#L13) | VERIFIED |
| `/api/merchant/business-profile` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/business-profile/route.ts:26`](../../app/api/merchant/business-profile/route.ts#L26) | VERIFIED |
| `/api/merchant/public-keys` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/merchant/public-keys/route.ts:5`](../../app/api/merchant/public-keys/route.ts#L5) | VERIFIED |
| `/api/merchant/public-keys` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/public-keys/route.ts:22`](../../app/api/merchant/public-keys/route.ts#L22) | VERIFIED |
| `/api/merchant/public-keys/[id]` | DELETE | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/public-keys/[id]/route.ts:5`](../../app/api/merchant/public-keys/[id]/route.ts#L5) | VERIFIED |
| `/api/merchant/webhook-deliveries` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/merchant/webhook-deliveries/route.ts:7`](../../app/api/merchant/webhook-deliveries/route.ts#L7) | VERIFIED |
| `/api/merchant/webhooks` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/merchant/webhooks/route.ts:25`](../../app/api/merchant/webhooks/route.ts#L25) | VERIFIED |
| `/api/merchant/webhooks` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/webhooks/route.ts:45`](../../app/api/merchant/webhooks/route.ts#L45) | VERIFIED |
| `/api/merchant/webhooks` | DELETE | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/webhooks/route.ts:104`](../../app/api/merchant/webhooks/route.ts#L104) | VERIFIED |
| `/api/merchant/webhooks/test` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/merchant/webhooks/test/route.ts:6`](../../app/api/merchant/webhooks/test/route.ts#L6) | VERIFIED |
| `/api/mesh/connect-callback` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/mesh/connect-callback/route.ts:16`](../../app/api/mesh/connect-callback/route.ts#L16) | VERIFIED |
| `/api/mesh/connections` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/mesh/connections/route.ts:14`](../../app/api/mesh/connections/route.ts#L14) | VERIFIED |
| `/api/mesh/import-addresses` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/mesh/import-addresses/route.ts:50`](../../app/api/mesh/import-addresses/route.ts#L50) | VERIFIED |
| `/api/mesh/link-token` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/mesh/link-token/route.ts:16`](../../app/api/mesh/link-token/route.ts#L16) | VERIFIED |
| `/api/oauth/coinbase/callback` | GET | OAUTH_CALLBACK | HMAC-signed `coinbase_oauth_context` cookie + `state` equality | Merchant id from the signed cookie, never the query; tokens stored server-side only | Yes | [`app/api/oauth/coinbase/callback/route.ts:72`](../../app/api/oauth/coinbase/callback/route.ts#L72) | VERIFIED |
| `/api/oauth/coinbase/start` | GET | DASHBOARD_SESSION | Supabase session cookie | Signs a 300s context cookie bound to the logged-in merchant | Yes | [`app/api/oauth/coinbase/start/route.ts:11`](../../app/api/oauth/coinbase/start/route.ts#L11) | VERIFIED |
| `/api/off-ramp/quote` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/off-ramp/quote/route.ts:43`](../../app/api/off-ramp/quote/route.ts#L43) | VERIFIED |
| `/api/off-ramp/sessions` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/off-ramp/sessions/route.ts:41`](../../app/api/off-ramp/sessions/route.ts#L41) | VERIFIED |
| `/api/off-ramp/sessions` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/off-ramp/sessions/route.ts:62`](../../app/api/off-ramp/sessions/route.ts#L62) | VERIFIED |
| `/api/off-ramp/sessions/[id]/deposit-instructions/preview` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/off-ramp/sessions/[id]/deposit-instructions/preview/route.ts:34`](../../app/api/off-ramp/sessions/[id]/deposit-instructions/preview/route.ts#L34) | VERIFIED |
| `/api/off-ramp/sessions/[id]/prepare` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/off-ramp/sessions/[id]/prepare/route.ts:38`](../../app/api/off-ramp/sessions/[id]/prepare/route.ts#L38) | VERIFIED |
| `/api/off-ramp/sessions/[id]/wallet-approval/preview` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/off-ramp/sessions/[id]/wallet-approval/preview/route.ts:34`](../../app/api/off-ramp/sessions/[id]/wallet-approval/preview/route.ts#L34) | VERIFIED |
| `/api/off-ramp/sessions/[id]/widget-url` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/off-ramp/sessions/[id]/widget-url/route.ts:41`](../../app/api/off-ramp/sessions/[id]/widget-url/route.ts#L41) | VERIFIED |
| `/api/off-ramp/support` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/off-ramp/support/route.ts:12`](../../app/api/off-ramp/support/route.ts#L12) | VERIFIED |
| `/api/onboarding/business-verification` | GET | DASHBOARD_SESSION | `requireOnboardingMerchantSession` (session only; API key → 403) | Merchant id from the session | No | [`app/api/onboarding/business-verification/route.ts:23`](../../app/api/onboarding/business-verification/route.ts#L23) | VERIFIED |
| `/api/onboarding/business-verification/consent` | POST | DASHBOARD_SESSION | `requireOnboardingMerchantSession` (session only; API key → 403) | Merchant id from the session | Yes | [`app/api/onboarding/business-verification/consent/route.ts:24`](../../app/api/onboarding/business-verification/consent/route.ts#L24) | VERIFIED |
| `/api/onboarding/business-verification/continue` | POST | DASHBOARD_SESSION | `requireOnboardingMerchantSession` (session only; API key → 403) | Merchant id from the session | Yes | [`app/api/onboarding/business-verification/continue/route.ts:23`](../../app/api/onboarding/business-verification/continue/route.ts#L23) | VERIFIED |
| `/api/onboarding/business-verification/refresh` | POST | DASHBOARD_SESSION | `requireOnboardingMerchantSession` (session only; API key → 403) | Merchant id from the session | Yes | [`app/api/onboarding/business-verification/refresh/route.ts:24`](../../app/api/onboarding/business-verification/refresh/route.ts#L24) | VERIFIED |
| `/api/payment-intents/[intentId]` | GET | PUBLIC | None — by design | Intent id possession; **spreads the whole intent row** incl. `merchant_id`, `pinetree_fee`, `metadata` | No | [`app/api/payment-intents/[intentId]/route.ts:12`](../../app/api/payment-intents/[intentId]/route.ts#L12) | FINDING RA-3 |
| `/api/payment-intents/[intentId]/abandon` | POST | PUBLIC_CAPABILITY | `verifyCheckoutSession` (HMAC `pco_` bound to the intent) | Token `iid` must equal the path intent | Yes | [`app/api/payment-intents/[intentId]/abandon/route.ts:8`](../../app/api/payment-intents/[intentId]/abandon/route.ts#L8) | VERIFIED |
| `/api/payment-intents/[intentId]/cancel` | POST | TERMINAL_SESSION | Three accepted paths: `pco_` checkout token, `pts_` terminal token, **or** merchant auth | `pco_` is bound to the intent; `pts_`/merchant supply the merchant id from signed claims | Yes | [`app/api/payment-intents/[intentId]/cancel/route.ts:10`](../../app/api/payment-intents/[intentId]/cancel/route.ts#L10) | VERIFIED |
| `/api/payment-intents/[intentId]/select-network` | POST | PUBLIC_CAPABILITY | `verifyCheckoutSession` (HMAC `pco_` bound to the intent) | Token `iid` must equal the path intent | Yes | [`app/api/payment-intents/[intentId]/select-network/route.ts:51`](../../app/api/payment-intents/[intentId]/select-network/route.ts#L51) | VERIFIED |
| `/api/payment-readiness` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/payment-readiness/route.ts:5`](../../app/api/payment-readiness/route.ts#L5) | VERIFIED |
| `/api/payments` | POST | TERMINAL_SESSION | `requireTerminalSession` (`pts_`) **or** `requireMerchantIdFromRequest` — either is sufficient | Merchant id from whichever credential was presented; never from the body | Yes | [`app/api/payments/route.ts:27`](../../app/api/payments/route.ts#L27) | VERIFIED |
| `/api/payments/[paymentId]` | GET | PUBLIC | None — by design | Payment id possession; explicit safe-field allowlist (no merchant id, fee split, or metadata) | No | [`app/api/payments/[paymentId]/route.ts:7`](../../app/api/payments/[paymentId]/route.ts#L7) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/base-v7/allowance-check` | POST | PUBLIC | None — by design | Payment id possession; builds or relays an unsigned transaction, returns no merchant data | Yes | [`app/api/payments/[paymentId]/base-v7/allowance-check/route.ts:4`](../../app/api/payments/[paymentId]/base-v7/allowance-check/route.ts#L4) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/base-v7/build-allowance-payment` | POST | PUBLIC | None — by design | Payment id possession; builds or relays an unsigned transaction, returns no merchant data | Yes | [`app/api/payments/[paymentId]/base-v7/build-allowance-payment/route.ts:4`](../../app/api/payments/[paymentId]/base-v7/build-allowance-payment/route.ts#L4) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/base-v7/delegated/prepare` | POST | PUBLIC | None — by design | Payment id possession; builds or relays an unsigned transaction, returns no merchant data | Yes | [`app/api/payments/[paymentId]/base-v7/delegated/prepare/route.ts:4`](../../app/api/payments/[paymentId]/base-v7/delegated/prepare/route.ts#L4) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/base-v7/delegated/status` | POST | PUBLIC | None — by design | Payment id possession; builds or relays an unsigned transaction, returns no merchant data | Yes | [`app/api/payments/[paymentId]/base-v7/delegated/status/route.ts:4`](../../app/api/payments/[paymentId]/base-v7/delegated/status/route.ts#L4) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/base-v7/prepare` | POST | PUBLIC | None — by design | Payment id possession; builds or relays an unsigned transaction, returns no merchant data | Yes | [`app/api/payments/[paymentId]/base-v7/prepare/route.ts:4`](../../app/api/payments/[paymentId]/base-v7/prepare/route.ts#L4) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/base-v7/relay` | POST | PUBLIC | None — by design | Payment id possession; builds or relays an unsigned transaction, returns no merchant data | Yes | [`app/api/payments/[paymentId]/base-v7/relay/route.ts:4`](../../app/api/payments/[paymentId]/base-v7/relay/route.ts#L4) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/base-v7/strategy` | POST | PUBLIC | None — by design | Payment id possession; builds or relays an unsigned transaction, returns no merchant data | Yes | [`app/api/payments/[paymentId]/base-v7/strategy/route.ts:5`](../../app/api/payments/[paymentId]/base-v7/strategy/route.ts#L5) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/detect` | POST | PUBLIC | None — by design | Payment id possession; a supplied `txHash` is a hint only — finality comes from the Engine's on-chain evidence gate | Yes | [`app/api/payments/[paymentId]/detect/route.ts:6`](../../app/api/payments/[paymentId]/detect/route.ts#L6) | VERIFIED_PUBLIC |
| `/api/payments/[paymentId]/fail` | POST | TERMINAL_SESSION | Three accepted paths: `pco_` checkout token, `pts_` terminal token, **or** merchant auth | `pco_` is bound to the intent; `pts_`/merchant supply the merchant id from signed claims | Yes | [`app/api/payments/[paymentId]/fail/route.ts:21`](../../app/api/payments/[paymentId]/fail/route.ts#L21) | VERIFIED |
| `/api/payments/[paymentId]/lightning/check` | POST | PUBLIC_CAPABILITY | `verifyCheckoutSession` (HMAC `pco_` bound to the intent) | Token `iid` must equal the path intent | Yes | [`app/api/payments/[paymentId]/lightning/check/route.ts:12`](../../app/api/payments/[paymentId]/lightning/check/route.ts#L12) | VERIFIED |
| `/api/payments/create` | POST | TERMINAL_SESSION | Compatibility alias — `export { POST } from "../route"`, so it is byte-for-byte the `/api/payments` handler (`requireTerminalSession` or `requireMerchantIdFromRequest`) | Merchant id from the terminal claims or the verified token | Yes | [`app/api/payments/create/route.ts:8`](../../app/api/payments/create/route.ts#L8) | VERIFIED |
| `/api/payments/status` | GET | PUBLIC | None — by design | Payment/intent id possession; response limited to status + ids | No | [`app/api/payments/status/route.ts:7`](../../app/api/payments/status/route.ts#L7) | VERIFIED_PUBLIC RA-10 |
| `/api/payments/stripe/manual` | POST | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | Yes | [`app/api/payments/stripe/manual/route.ts:6`](../../app/api/payments/stripe/manual/route.ts#L6) | VERIFIED |
| `/api/payments/stripe/terminal` | POST | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | Yes | [`app/api/payments/stripe/terminal/route.ts:6`](../../app/api/payments/stripe/terminal/route.ts#L6) | VERIFIED |
| `/api/payments/stripe/terminal/[paymentId]` | GET | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | No | [`app/api/payments/stripe/terminal/[paymentId]/route.ts:6`](../../app/api/payments/stripe/terminal/[paymentId]/route.ts#L6) | VERIFIED |
| `/api/payments/stripe/terminal/[paymentId]/cancel` | POST | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | Yes | [`app/api/payments/stripe/terminal/[paymentId]/cancel/route.ts:6`](../../app/api/payments/stripe/terminal/[paymentId]/cancel/route.ts#L6) | VERIFIED |
| `/api/pos/base-session/[intentId]` | GET | PUBLIC | None — documented public mirror for hosted checkout | Intent id possession; returns only safe mirror fields (pairing URI, step, masked address) — no keys, no signatures, no full address | No | [`app/api/pos/base-session/[intentId]/route.ts:21`](../../app/api/pos/base-session/[intentId]/route.ts#L21) | VERIFIED_PUBLIC |
| `/api/pos/base-session/[intentId]` | POST | TERMINAL_SESSION | `requireTerminalSession`; the `mid`/`tid` claims are retained and are the only identity source | Merchant-scoped read (`getPaymentIntentForMerchant`), an explicit `merchant_id` invariant, exact `terminal_id` match when the intent is terminal-bound, and both service-role updates carry `merchant_id`. Foreign or unknown intent → 404 | Yes | [`app/api/pos/base-session/[intentId]/route.ts:78`](../../app/api/pos/base-session/[intentId]/route.ts#L78) | VERIFIED RA-4 |
| `/api/pos/breakdown` | GET | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | No | [`app/api/pos/breakdown/route.ts:6`](../../app/api/pos/breakdown/route.ts#L6) | VERIFIED |
| `/api/pos/card/payment-link` | POST | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | Yes | [`app/api/pos/card/payment-link/route.ts:10`](../../app/api/pos/card/payment-link/route.ts#L10) | VERIFIED |
| `/api/pos/drawer/balance` | GET | TERMINAL_SESSION | `requireTerminalSession` (`pts_`) **or** `requireMerchantIdFromRequest` — either is sufficient | Merchant id from whichever credential was presented; never from the body | No | [`app/api/pos/drawer/balance/route.ts:7`](../../app/api/pos/drawer/balance/route.ts#L7) | VERIFIED |
| `/api/pos/drawer/closeout` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/pos/drawer/closeout/route.ts:5`](../../app/api/pos/drawer/closeout/route.ts#L5) | VERIFIED |
| `/api/pos/drawer/open` | POST | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | Yes | [`app/api/pos/drawer/open/route.ts:6`](../../app/api/pos/drawer/open/route.ts#L6) | VERIFIED |
| `/api/pos/drawer/sale` | POST | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | Yes | [`app/api/pos/drawer/sale/route.ts:7`](../../app/api/pos/drawer/sale/route.ts#L7) | VERIFIED |
| `/api/pos/methods` | GET | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | No | [`app/api/pos/methods/route.ts:6`](../../app/api/pos/methods/route.ts#L6) | VERIFIED |
| `/api/pos/payment` | POST | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | Yes | [`app/api/pos/payment/route.ts:7`](../../app/api/pos/payment/route.ts#L7) | VERIFIED |
| `/api/pos/shift4-manual-authorization` | POST | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | Yes | [`app/api/pos/shift4-manual-authorization/route.ts:38`](../../app/api/pos/shift4-manual-authorization/route.ts#L38) | VERIFIED |
| `/api/pos/shift4-referral-status` | GET | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | No | [`app/api/pos/shift4-referral-status/route.ts:40`](../../app/api/pos/shift4-referral-status/route.ts#L40) | VERIFIED |
| `/api/pos/shift4-retail-preparation` | POST | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | Yes | [`app/api/pos/shift4-retail-preparation/route.ts:33`](../../app/api/pos/shift4-retail-preparation/route.ts#L33) | VERIFIED |
| `/api/pos/shift4-retail-readers` | GET | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | No | [`app/api/pos/shift4-retail-readers/route.ts:15`](../../app/api/pos/shift4-retail-readers/route.ts#L15) | VERIFIED |
| `/api/pos/shift4-retail-readers` | POST | TERMINAL_SESSION | `requireTerminalSession` (HMAC `pts_`, 24h TTL, `timingSafeEqual`) | Merchant + terminal from the signed claims | Yes | [`app/api/pos/shift4-retail-readers/route.ts:28`](../../app/api/pos/shift4-retail-readers/route.ts#L28) | VERIFIED |
| `/api/pos/terminal-auth` | POST | RETIRED | None — returns 410 Gone | n/a | No | [`app/api/pos/terminal-auth/route.ts:41`](../../app/api/pos/terminal-auth/route.ts#L41) | VERIFIED_RETIRED RA-1 |
| `/api/pos/terminal-auth` | GET | RETIRED | None — returns 410 Gone | n/a | No | [`app/api/pos/terminal-auth/route.ts:45`](../../app/api/pos/terminal-auth/route.ts#L45) | VERIFIED_RETIRED RA-1 |
| `/api/pos/terminal-exit-auth` | POST | TERMINAL_SESSION | `requireTerminalSession` (`pts_`) **then** the 4-digit PIN verified server-side; 5-per-15-min limiter keyed on the terminal id from the signed claims | Merchant and terminal both come from the signed claims — there is no `terminalId` in the request. Authorizes the exit action only and **issues no credential** | No | [`app/api/pos/terminal-exit-auth/route.ts:30`](../../app/api/pos/terminal-exit-auth/route.ts#L30) | VERIFIED RA-1 |
| `/api/pos/terminal-session` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` — a verified merchant session is required; the `/terminal` page is itself proxy-protected | Merchant id from the verified session, never from query or body; the Engine requires `terminal.merchant_id` to equal it before signing, and reports a foreign terminal as 404. Issues the scoped `pts_` credential so launch needs no PIN | Yes | [`app/api/pos/terminal-session/route.ts:37`](../../app/api/pos/terminal-session/route.ts#L37) | VERIFIED RA-1 |
| `/api/pos/terminal-session` | POST | PUBLIC | Recovery phrase verified server-side (`resetPosTerminalPinWithRecoveryEngine`) | Recovery-phrase possession authorizes a PIN reset on that terminal only; issues no session token. **No rate limiter on this path** | Yes | [`app/api/pos/terminal-session/route.ts:54`](../../app/api/pos/terminal-session/route.ts#L54) | VERIFIED_PUBLIC RA-9 |
| `/api/pos/terminals` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/pos/terminals/route.ts:18`](../../app/api/pos/terminals/route.ts#L18) | VERIFIED |
| `/api/pos/terminals` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/pos/terminals/route.ts:39`](../../app/api/pos/terminals/route.ts#L39) | VERIFIED |
| `/api/pos/terminals` | DELETE | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/pos/terminals/route.ts:102`](../../app/api/pos/terminals/route.ts#L102) | VERIFIED |
| `/api/providers` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/providers/route.ts:18`](../../app/api/providers/route.ts#L18) | VERIFIED |
| `/api/providers` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/providers/route.ts:31`](../../app/api/providers/route.ts#L31) | VERIFIED |
| `/api/providers/[provider]/setup-return` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/providers/[provider]/setup-return/route.ts:15`](../../app/api/providers/[provider]/setup-return/route.ts#L15) | VERIFIED |
| `/api/providers/[provider]/start-setup` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/providers/[provider]/start-setup/route.ts:15`](../../app/api/providers/[provider]/start-setup/route.ts#L15) | VERIFIED |
| `/api/providers/stripe/account` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/providers/stripe/account/route.ts:15`](../../app/api/providers/stripe/account/route.ts#L15) | VERIFIED |
| `/api/providers/stripe/account-session` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/providers/stripe/account-session/route.ts:15`](../../app/api/providers/stripe/account-session/route.ts#L15) | VERIFIED |
| `/api/providers/stripe/card-capabilities` | GET | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | No | [`app/api/providers/stripe/card-capabilities/route.ts:6`](../../app/api/providers/stripe/card-capabilities/route.ts#L6) | VERIFIED |
| `/api/providers/stripe/card-settings` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/providers/stripe/card-settings/route.ts:6`](../../app/api/providers/stripe/card-settings/route.ts#L6) | VERIFIED |
| `/api/providers/stripe/card-settings` | PATCH | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/providers/stripe/card-settings/route.ts:22`](../../app/api/providers/stripe/card-settings/route.ts#L22) | VERIFIED |
| `/api/providers/stripe/connect/start` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/providers/stripe/connect/start/route.ts:9`](../../app/api/providers/stripe/connect/start/route.ts#L9) | VERIFIED |
| `/api/providers/stripe/connect/sync` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/providers/stripe/connect/sync/route.ts:8`](../../app/api/providers/stripe/connect/sync/route.ts#L8) | VERIFIED |
| `/api/providers/stripe/status` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/providers/stripe/status/route.ts:14`](../../app/api/providers/stripe/status/route.ts#L14) | VERIFIED |
| `/api/providers/stripe/terminal/connection-token` | POST | TERMINAL_SESSION | `requireTrustedNativeMerchant` (`PINETREE_NATIVE_CLIENT_SECRET`, constant-time) | Merchant id from the token claims | Yes | [`app/api/providers/stripe/terminal/connection-token/route.ts:6`](../../app/api/providers/stripe/terminal/connection-token/route.ts#L6) | VERIFIED |
| `/api/providers/stripe/terminal/locations` | GET | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | No | [`app/api/providers/stripe/terminal/locations/route.ts:10`](../../app/api/providers/stripe/terminal/locations/route.ts#L10) | VERIFIED |
| `/api/providers/stripe/terminal/locations` | POST | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | Yes | [`app/api/providers/stripe/terminal/locations/route.ts:15`](../../app/api/providers/stripe/terminal/locations/route.ts#L15) | VERIFIED |
| `/api/providers/stripe/terminal/native-config` | GET | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | No | [`app/api/providers/stripe/terminal/native-config/route.ts:6`](../../app/api/providers/stripe/terminal/native-config/route.ts#L6) | VERIFIED |
| `/api/providers/stripe/terminal/readers` | GET | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | No | [`app/api/providers/stripe/terminal/readers/route.ts:6`](../../app/api/providers/stripe/terminal/readers/route.ts#L6) | VERIFIED |
| `/api/providers/stripe/terminal/readers/default` | POST | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | Yes | [`app/api/providers/stripe/terminal/readers/default/route.ts:6`](../../app/api/providers/stripe/terminal/readers/default/route.ts#L6) | VERIFIED |
| `/api/providers/stripe/terminal/readers/register` | POST | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | Yes | [`app/api/providers/stripe/terminal/readers/register/route.ts:6`](../../app/api/providers/stripe/terminal/readers/register/route.ts#L6) | VERIFIED |
| `/api/providers/stripe/terminal/readers/simulate-payment` | POST | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | Yes | [`app/api/providers/stripe/terminal/readers/simulate-payment/route.ts:6`](../../app/api/providers/stripe/terminal/readers/simulate-payment/route.ts#L6) | VERIFIED |
| `/api/providers/stripe/terminal/readers/simulated` | POST | TERMINAL_SESSION | `requireStripeCardMerchant` (`pts_` token or merchant auth) | Merchant id from the token claims | Yes | [`app/api/providers/stripe/terminal/readers/simulated/route.ts:6`](../../app/api/providers/stripe/terminal/readers/simulated/route.ts#L6) | VERIFIED |
| `/api/receipts/[paymentId]` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/receipts/[paymentId]/route.ts:5`](../../app/api/receipts/[paymentId]/route.ts#L5) | VERIFIED |
| `/api/receipts/[paymentId]/download` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/receipts/[paymentId]/download/route.ts:5`](../../app/api/receipts/[paymentId]/download/route.ts#L5) | VERIFIED |
| `/api/reports` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/reports/route.ts:8`](../../app/api/reports/route.ts#L8) | VERIFIED |
| `/api/reports/download` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/reports/download/route.ts:14`](../../app/api/reports/download/route.ts#L14) | VERIFIED |
| `/api/reports/email` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/reports/email/route.ts:8`](../../app/api/reports/email/route.ts#L8) | VERIFIED |
| `/api/reports/pdf` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/reports/pdf/route.ts:9`](../../app/api/reports/pdf/route.ts#L9) | VERIFIED |
| `/api/settings` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/settings/route.ts:18`](../../app/api/settings/route.ts#L18) | VERIFIED |
| `/api/settings` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/settings/route.ts:70`](../../app/api/settings/route.ts#L70) | VERIFIED |
| `/api/settings` | PATCH | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/settings/route.ts:66`](../../app/api/settings/route.ts#L66) | VERIFIED |
| `/api/shopify/auth` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/shopify/auth/route.ts:77`](../../app/api/shopify/auth/route.ts#L77) | VERIFIED |
| `/api/shopify/auth` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/shopify/auth/route.ts:81`](../../app/api/shopify/auth/route.ts#L81) | VERIFIED |
| `/api/shopify/auth/callback` | GET | OAUTH_CALLBACK | Signed context cookie + `state` match + Shopify HMAC over all query params | Merchant id from the signed cookie; shop domain validated; token exchanged server-side and encrypted at rest | Yes | [`app/api/shopify/auth/callback/route.ts:13`](../../app/api/shopify/auth/callback/route.ts#L13) | VERIFIED |
| `/api/shopify/disconnect` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/shopify/disconnect/route.ts:11`](../../app/api/shopify/disconnect/route.ts#L11) | VERIFIED |
| `/api/shopify/session` | POST | RETIRED | None — returns 410 Gone. No signature parsing, no body read | n/a — no connection lookup, no order validation, no database access, no session creation | No | [`app/api/shopify/session/route.ts:57`](../../app/api/shopify/session/route.ts#L57) | VERIFIED_RETIRED RA-2 |
| `/api/shopify/status` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/shopify/status/route.ts:12`](../../app/api/shopify/status/route.ts#L12) | VERIFIED |
| `/api/shopify/webhooks` | POST | PROVIDER_WEBHOOK | `verifyShopifyWebhook` HMAC-SHA256 over the raw body; 401 on mismatch | Shop resolved from the verified payload | Yes | [`app/api/shopify/webhooks/route.ts:10`](../../app/api/shopify/webhooks/route.ts#L10) | VERIFIED |
| `/api/solana-pay/transaction` | GET | PUBLIC | None — Solana Pay protocol; the proxy explicitly bypasses it (wallets send no cookies) | Payment reference possession | No | [`app/api/solana-pay/transaction/route.ts:15`](../../app/api/solana-pay/transaction/route.ts#L15) | VERIFIED_PUBLIC |
| `/api/solana-pay/transaction` | POST | PUBLIC | None — Solana Pay protocol; the proxy explicitly bypasses it (wallets send no cookies) | Payment reference possession | Yes | [`app/api/solana-pay/transaction/route.ts:33`](../../app/api/solana-pay/transaction/route.ts#L33) | VERIFIED_PUBLIC |
| `/api/solana-pay/transaction` | OPTIONS | PUBLIC | None — Solana Pay protocol; the proxy explicitly bypasses it (wallets send no cookies) | Payment reference possession | No | [`app/api/solana-pay/transaction/route.ts:11`](../../app/api/solana-pay/transaction/route.ts#L11) | VERIFIED_PUBLIC |
| `/api/solana/build-wallet-transaction` | POST | PUBLIC | None — by design | Payment id possession; returns an unsigned transaction only | Yes | [`app/api/solana/build-wallet-transaction/route.ts:4`](../../app/api/solana/build-wallet-transaction/route.ts#L4) | VERIFIED_PUBLIC |
| `/api/solana/unsigned-tx` | GET | PUBLIC | None — by design | Payment id possession; returns an unsigned transaction only | No | [`app/api/solana/unsigned-tx/route.ts:4`](../../app/api/solana/unsigned-tx/route.ts#L4) | VERIFIED_PUBLIC |
| `/api/solflare/build-sign-url` | POST | PUBLIC | None — by design | Unguessable `flowId` / `paymentId` is the capability; the deeplink session is looked up server-side | Yes | [`app/api/solflare/build-sign-url/route.ts:7`](../../app/api/solflare/build-sign-url/route.ts#L7) | VERIFIED_PUBLIC |
| `/api/solflare/connect-callback` | POST | PUBLIC | None — by design | Unguessable `flowId` / `paymentId` is the capability; the deeplink session is looked up server-side | Yes | [`app/api/solflare/connect-callback/route.ts:11`](../../app/api/solflare/connect-callback/route.ts#L11) | VERIFIED_PUBLIC |
| `/api/solflare/sign-callback` | POST | PUBLIC | None — by design | Unguessable `flowId` / `paymentId` is the capability; the deeplink session is looked up server-side | Yes | [`app/api/solflare/sign-callback/route.ts:10`](../../app/api/solflare/sign-callback/route.ts#L10) | VERIFIED_PUBLIC |
| `/api/solflare/start` | POST | PUBLIC | None — by design | Unguessable `flowId` / `paymentId` is the capability; the deeplink session is looked up server-side | Yes | [`app/api/solflare/start/route.ts:11`](../../app/api/solflare/start/route.ts#L11) | VERIFIED_PUBLIC |
| `/api/support/feedback` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/support/feedback/route.ts:36`](../../app/api/support/feedback/route.ts#L36) | VERIFIED |
| `/api/support/tickets` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/support/tickets/route.ts:40`](../../app/api/support/tickets/route.ts#L40) | VERIFIED |
| `/api/support/tickets` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/support/tickets/route.ts:54`](../../app/api/support/tickets/route.ts#L54) | VERIFIED |
| `/api/support/tickets/[ticketId]` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/support/tickets/[ticketId]/route.ts:15`](../../app/api/support/tickets/[ticketId]/route.ts#L15) | VERIFIED |
| `/api/support/tickets/[ticketId]/messages` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/support/tickets/[ticketId]/messages/route.ts:17`](../../app/api/support/tickets/[ticketId]/messages/route.ts#L17) | VERIFIED |
| `/api/support/tickets/[ticketId]/read` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/support/tickets/[ticketId]/read/route.ts:22`](../../app/api/support/tickets/[ticketId]/read/route.ts#L22) | VERIFIED |
| `/api/support/unread` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/support/unread/route.ts:14`](../../app/api/support/unread/route.ts#L14) | VERIFIED |
| `/api/transactions` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/transactions/route.ts:32`](../../app/api/transactions/route.ts#L32) | VERIFIED |
| `/api/transactions` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/transactions/route.ts:84`](../../app/api/transactions/route.ts#L84) | VERIFIED |
| `/api/v1/browser/checkout/sessions` | POST | API_KEY | `verifyMerchantPublicKey` (`pk_live_` public key) | Create-only; no private reads | Yes | [`app/api/v1/browser/checkout/sessions/route.ts:28`](../../app/api/v1/browser/checkout/sessions/route.ts#L28) | VERIFIED |
| `/api/v1/checkout/sessions` | GET | API_KEY | `requireV1MerchantApiKey` (`pt_live_`, hashed lookup, scope enforced) | Lookups scoped by the key's merchant id; 404 when not owned | No | [`app/api/v1/checkout/sessions/route.ts:36`](../../app/api/v1/checkout/sessions/route.ts#L36) | VERIFIED |
| `/api/v1/checkout/sessions` | POST | API_KEY | `requireV1MerchantApiKey` (`pt_live_`, hashed lookup, scope enforced) | Lookups scoped by the key's merchant id; 404 when not owned | Yes | [`app/api/v1/checkout/sessions/route.ts:56`](../../app/api/v1/checkout/sessions/route.ts#L56) | VERIFIED |
| `/api/v1/checkout/sessions/[id]` | GET | API_KEY | `requireV1MerchantApiKey` (`pt_live_`, hashed lookup, scope enforced) | Lookups scoped by the key's merchant id; 404 when not owned | No | [`app/api/v1/checkout/sessions/[id]/route.ts:6`](../../app/api/v1/checkout/sessions/[id]/route.ts#L6) | VERIFIED |
| `/api/v1/checkout/sessions/[id]/cancel` | POST | API_KEY | `handleCheckoutSessionLifecycle` → `requireV1MerchantApiKeyWithAnyPermission` (`checkout.sessions:write` or `:create`) | Session loaded with the key's merchant id; 404 when not owned | Yes | [`app/api/v1/checkout/sessions/[id]/cancel/route.ts:4`](../../app/api/v1/checkout/sessions/[id]/cancel/route.ts#L4) | VERIFIED |
| `/api/v1/checkout/sessions/[id]/expire` | POST | API_KEY | `handleCheckoutSessionLifecycle` → `requireV1MerchantApiKeyWithAnyPermission` (`checkout.sessions:write` or `:create`) | Session loaded with the key's merchant id; 404 when not owned | Yes | [`app/api/v1/checkout/sessions/[id]/expire/route.ts:4`](../../app/api/v1/checkout/sessions/[id]/expire/route.ts#L4) | VERIFIED |
| `/api/v1/payments/[id]` | GET | API_KEY | `requireV1MerchantApiKey` (`pt_live_`, hashed lookup, scope enforced) | Lookups scoped by the key's merchant id; 404 when not owned | No | [`app/api/v1/payments/[id]/route.ts:6`](../../app/api/v1/payments/[id]/route.ts#L6) | VERIFIED |
| `/api/v1/webhook-deliveries` | GET | API_KEY | `requireV1MerchantApiKey` (`pt_live_`, hashed lookup, scope enforced) | Lookups scoped by the key's merchant id; 404 when not owned | No | [`app/api/v1/webhook-deliveries/route.ts:7`](../../app/api/v1/webhook-deliveries/route.ts#L7) | VERIFIED |
| `/api/v1/webhook-deliveries/[id]/retry` | POST | API_KEY | `requireV1MerchantApiKey` (`pt_live_`, hashed lookup, scope enforced) | Lookups scoped by the key's merchant id; 404 when not owned | Yes | [`app/api/v1/webhook-deliveries/[id]/retry/route.ts:7`](../../app/api/v1/webhook-deliveries/[id]/retry/route.ts#L7) | VERIFIED |
| `/api/validate` | POST | ADMIN | `requireAdminFromRequest` → `merchants.role == "admin"` | Platform-wide by role; 403 otherwise | Yes | [`app/api/validate/route.ts:5`](../../app/api/validate/route.ts#L5) | VERIFIED |
| `/api/wallet-connect-session` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallet-connect-session/route.ts:21`](../../app/api/wallet-connect-session/route.ts#L21) | VERIFIED |
| `/api/wallet-connect-session` | POST | PUBLIC | **None** — wallet return pages run in popups with no auth context | Possession of the `crypto.randomUUID()` session id; status allowlisted to `pending`/`connected`; persisting an address still requires a merchant-authenticated Save | Yes | [`app/api/wallet-connect-session/route.ts:70`](../../app/api/wallet-connect-session/route.ts#L70) | FINDING RA-11 |
| `/api/wallet-connect-session` | DELETE | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallet-connect-session/route.ts:99`](../../app/api/wallet-connect-session/route.ts#L99) | VERIFIED |
| `/api/walletconnect/base-wallets` | GET | PUBLIC | None — wallet metadata | No merchant or payment data; the WalletConnect project id stays server-side | No | [`app/api/walletconnect/base-wallets/route.ts:80`](../../app/api/walletconnect/base-wallets/route.ts#L80) | VERIFIED_PUBLIC |
| `/api/wallets/activity` | GET | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | No | [`app/api/wallets/activity/route.ts:29`](../../app/api/wallets/activity/route.ts#L29) | VERIFIED |
| `/api/wallets/balances` | GET | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | No | [`app/api/wallets/balances/route.ts:5`](../../app/api/wallets/balances/route.ts#L5) | VERIFIED |
| `/api/wallets/capabilities` | GET | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | No | [`app/api/wallets/capabilities/route.ts:5`](../../app/api/wallets/capabilities/route.ts#L5) | VERIFIED |
| `/api/wallets/dynamic/external-jwt` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/dynamic/external-jwt/route.ts:114`](../../app/api/wallets/dynamic/external-jwt/route.ts#L114) | VERIFIED |
| `/api/wallets/dynamic/external-jwt` | POST | DASHBOARD_SESSION | `requireSupabaseMerchant` (session only) | Merchant id from the session | Yes | [`app/api/wallets/dynamic/external-jwt/route.ts:146`](../../app/api/wallets/dynamic/external-jwt/route.ts#L146) | VERIFIED |
| `/api/wallets/lightning/pinetree-managed` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/lightning/pinetree-managed/route.ts:78`](../../app/api/wallets/lightning/pinetree-managed/route.ts#L78) | VERIFIED |
| `/api/wallets/lightning/pinetree-managed` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/lightning/pinetree-managed/route.ts:137`](../../app/api/wallets/lightning/pinetree-managed/route.ts#L137) | VERIFIED |
| `/api/wallets/lightning/settlement` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/lightning/settlement/route.ts:8`](../../app/api/wallets/lightning/settlement/route.ts#L8) | VERIFIED |
| `/api/wallets/lightning/settlement` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/lightning/settlement/route.ts:19`](../../app/api/wallets/lightning/settlement/route.ts#L19) | VERIFIED |
| `/api/wallets/operations/[operationId]` | GET | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | No | [`app/api/wallets/operations/[operationId]/route.ts:5`](../../app/api/wallets/operations/[operationId]/route.ts#L5) | VERIFIED |
| `/api/wallets/overview` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/overview/route.ts:12`](../../app/api/wallets/overview/route.ts#L12) | VERIFIED |
| `/api/wallets/payouts` | POST | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | Yes | [`app/api/wallets/payouts/route.ts:5`](../../app/api/wallets/payouts/route.ts#L5) | VERIFIED |
| `/api/wallets/payouts/[operationId]` | GET | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | No | [`app/api/wallets/payouts/[operationId]/route.ts:5`](../../app/api/wallets/payouts/[operationId]/route.ts#L5) | VERIFIED |
| `/api/wallets/pinetree-profile` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/pinetree-profile/route.ts:545`](../../app/api/wallets/pinetree-profile/route.ts#L545) | VERIFIED |
| `/api/wallets/pinetree-profile` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-profile/route.ts:153`](../../app/api/wallets/pinetree-profile/route.ts#L153) | VERIFIED |
| `/api/wallets/pinetree-wallet/rail-sync` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/rail-sync/route.ts:35`](../../app/api/wallets/pinetree-wallet/rail-sync/route.ts#L35) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawal-destinations` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/pinetree-wallet/withdrawal-destinations/route.ts:24`](../../app/api/wallets/pinetree-wallet/withdrawal-destinations/route.ts#L24) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawal-destinations` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawal-destinations/route.ts:41`](../../app/api/wallets/pinetree-wallet/withdrawal-destinations/route.ts#L41) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawal-destinations/[id]` | PATCH | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawal-destinations/[id]/route.ts:11`](../../app/api/wallets/pinetree-wallet/withdrawal-destinations/[id]/route.ts#L11) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawal-destinations/[id]` | DELETE | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawal-destinations/[id]/route.ts:32`](../../app/api/wallets/pinetree-wallet/withdrawal-destinations/[id]/route.ts#L32) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawal-destinations/[id]/confirm` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawal-destinations/[id]/confirm/route.ts:14`](../../app/api/wallets/pinetree-wallet/withdrawal-destinations/[id]/confirm/route.ts#L14) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawals` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawals/route.ts:14`](../../app/api/wallets/pinetree-wallet/withdrawals/route.ts#L14) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawals/[id]` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/pinetree-wallet/withdrawals/[id]/route.ts:6`](../../app/api/wallets/pinetree-wallet/withdrawals/[id]/route.ts#L6) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawals/[id]/discover` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawals/[id]/discover/route.ts:24`](../../app/api/wallets/pinetree-wallet/withdrawals/[id]/discover/route.ts#L24) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawals/[id]/prepare` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawals/[id]/prepare/route.ts:8`](../../app/api/wallets/pinetree-wallet/withdrawals/[id]/prepare/route.ts#L8) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawals/[id]/submit` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawals/[id]/submit/route.ts:10`](../../app/api/wallets/pinetree-wallet/withdrawals/[id]/submit/route.ts#L10) | VERIFIED |
| `/api/wallets/pinetree-wallet/withdrawals/max-estimate` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree-wallet/withdrawals/max-estimate/route.ts:9`](../../app/api/wallets/pinetree-wallet/withdrawals/max-estimate/route.ts#L9) | VERIFIED |
| `/api/wallets/pinetree/sync` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/pinetree/sync/route.ts:10`](../../app/api/wallets/pinetree/sync/route.ts#L10) | VERIFIED |
| `/api/wallets/preferences` | GET | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | No | [`app/api/wallets/preferences/route.ts:8`](../../app/api/wallets/preferences/route.ts#L8) | VERIFIED |
| `/api/wallets/preferences` | PUT | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | Yes | [`app/api/wallets/preferences/route.ts:12`](../../app/api/wallets/preferences/route.ts#L12) | VERIFIED |
| `/api/wallets/refresh` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/refresh/route.ts:12`](../../app/api/wallets/refresh/route.ts#L12) | VERIFIED |
| `/api/wallets/send-sessions` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` | Creation is merchant-only; the session is bound to the creating merchant | Yes | [`app/api/wallets/send-sessions/route.ts:23`](../../app/api/wallets/send-sessions/route.ts#L23) | VERIFIED |
| `/api/wallets/send-sessions/[id]` | GET | PUBLIC_CAPABILITY | None — the proxy explicitly bypasses these so the merchant's phone can approve without a session | Session UUID possession is the capability; status transitions allowlisted; expiry returns 410 | No | [`app/api/wallets/send-sessions/[id]/route.ts:40`](../../app/api/wallets/send-sessions/[id]/route.ts#L40) | VERIFIED_PUBLIC |
| `/api/wallets/send-sessions/[id]` | PATCH | PUBLIC_CAPABILITY | None — the proxy explicitly bypasses these so the merchant's phone can approve without a session | Session UUID possession is the capability; status transitions allowlisted; expiry returns 410 | Yes | [`app/api/wallets/send-sessions/[id]/route.ts:95`](../../app/api/wallets/send-sessions/[id]/route.ts#L95) | VERIFIED_PUBLIC |
| `/api/wallets/send-sessions/[id]/complete` | POST | PUBLIC_CAPABILITY | None — the proxy explicitly bypasses these so the merchant's phone can approve without a session | Session UUID possession is the capability; status transitions allowlisted; expiry returns 410 | Yes | [`app/api/wallets/send-sessions/[id]/complete/route.ts:33`](../../app/api/wallets/send-sessions/[id]/complete/route.ts#L33) | VERIFIED_PUBLIC |
| `/api/wallets/send-sessions/[id]/refresh-tx` | POST | PUBLIC_CAPABILITY | None — the proxy explicitly bypasses these so the merchant's phone can approve without a session | Session UUID possession is the capability; status transitions allowlisted; expiry returns 410 | Yes | [`app/api/wallets/send-sessions/[id]/refresh-tx/route.ts:30`](../../app/api/wallets/send-sessions/[id]/refresh-tx/route.ts#L30) | VERIFIED_PUBLIC |
| `/api/wallets/settlement/balances` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/settlement/balances/route.ts:25`](../../app/api/wallets/settlement/balances/route.ts#L25) | VERIFIED |
| `/api/wallets/settlement/destinations` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/settlement/destinations/route.ts:59`](../../app/api/wallets/settlement/destinations/route.ts#L59) | VERIFIED |
| `/api/wallets/settlement/destinations` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/settlement/destinations/route.ts:81`](../../app/api/wallets/settlement/destinations/route.ts#L81) | VERIFIED |
| `/api/wallets/settlement/preferences` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/settlement/preferences/route.ts:26`](../../app/api/wallets/settlement/preferences/route.ts#L26) | VERIFIED |
| `/api/wallets/settlement/preferences` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/settlement/preferences/route.ts:38`](../../app/api/wallets/settlement/preferences/route.ts#L38) | VERIFIED |
| `/api/wallets/settlement/withdrawals` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/wallets/settlement/withdrawals/route.ts:32`](../../app/api/wallets/settlement/withdrawals/route.ts#L32) | VERIFIED |
| `/api/wallets/settlement/withdrawals` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/settlement/withdrawals/route.ts:51`](../../app/api/wallets/settlement/withdrawals/route.ts#L51) | VERIFIED |
| `/api/wallets/swaps` | POST | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | Yes | [`app/api/wallets/swaps/route.ts:5`](../../app/api/wallets/swaps/route.ts#L5) | VERIFIED |
| `/api/wallets/swaps/[operationId]` | GET | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | No | [`app/api/wallets/swaps/[operationId]/route.ts:5`](../../app/api/wallets/swaps/[operationId]/route.ts#L5) | VERIFIED |
| `/api/wallets/swaps/quote` | POST | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | Yes | [`app/api/wallets/swaps/quote/route.ts:5`](../../app/api/wallets/swaps/quote/route.ts#L5) | VERIFIED |
| `/api/wallets/withdrawals` | POST | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | Yes | [`app/api/wallets/withdrawals/route.ts:78`](../../app/api/wallets/withdrawals/route.ts#L78) | VERIFIED |
| `/api/wallets/withdrawals/[operationId]` | GET | DASHBOARD_SESSION | `withWalletMerchant` → `requireMerchantIdFromRequest` | Handler only receives the resolved merchant id | No | [`app/api/wallets/withdrawals/[operationId]/route.ts:5`](../../app/api/wallets/withdrawals/[operationId]/route.ts#L5) | VERIFIED |
| `/api/webhooks/base` | POST | PROVIDER_WEBHOOK | Alchemy HMAC-SHA256 over the raw body, `verifyHexHmac` constant-time; 401 when the key is unset | Provider pinned by route; activity matched to payments by address in the Engine | Yes | [`app/api/webhooks/base/route.ts:60`](../../app/api/webhooks/base/route.ts#L60) | VERIFIED |
| `/api/webhooks/bridge` | GET | PUBLIC | None — unauthenticated liveness probe (health check), not the intake path | None needed: returns a fixed `{ok, provider, endpoint}` label and reads no data | No | [`app/api/webhooks/bridge/route.ts:21`](../../app/api/webhooks/bridge/route.ts#L21) | VERIFIED_PUBLIC |
| `/api/webhooks/bridge` | POST | PROVIDER_WEBHOOK | RSA-SHA256 over `timestamp.rawBody`, verify-before-parse, 10-min replay window; fails closed when the key is unset | Owner resolved from PineTree's stored Bridge ids, never the payload; event id claimed for dedup | Yes | [`app/api/webhooks/bridge/route.ts:25`](../../app/api/webhooks/bridge/route.ts#L25) | VERIFIED |
| `/api/webhooks/lightning` | GET | PUBLIC | None — unauthenticated liveness probe (health check), not the intake path | None needed: returns a fixed `{ok, provider, endpoint}` label and reads no data | No | [`app/api/webhooks/lightning/route.ts:6`](../../app/api/webhooks/lightning/route.ts#L6) | VERIFIED_PUBLIC |
| `/api/webhooks/lightning` | POST | PROVIDER_WEBHOOK | Svix HMAC over the raw body inside `processWebhook`; 400 on failure | Provider pinned by route | Yes | [`app/api/webhooks/lightning/route.ts:10`](../../app/api/webhooks/lightning/route.ts#L10) | VERIFIED RA-7 |
| `/api/webhooks/moonpay/off-ramp` | POST | PROVIDER_WEBHOOK | `Moonpay-Signature-V2` verified in the off-ramp engine; 401 on mismatch | Session matched server-side from the verified payload | Yes | [`app/api/webhooks/moonpay/off-ramp/route.ts:33`](../../app/api/webhooks/moonpay/off-ramp/route.ts#L33) | VERIFIED |
| `/api/webhooks/provider` | GET | RETIRED | None — every method returns 410 Gone | n/a | No | [`app/api/webhooks/provider/route.ts:52`](../../app/api/webhooks/provider/route.ts#L52) | VERIFIED_RETIRED |
| `/api/webhooks/provider` | POST | RETIRED | None — every method returns 410 Gone | n/a | No | [`app/api/webhooks/provider/route.ts:48`](../../app/api/webhooks/provider/route.ts#L48) | VERIFIED_RETIRED |
| `/api/webhooks/provider` | PUT | RETIRED | None — every method returns 410 Gone | n/a | No | [`app/api/webhooks/provider/route.ts:56`](../../app/api/webhooks/provider/route.ts#L56) | VERIFIED_RETIRED |
| `/api/webhooks/provider` | PATCH | RETIRED | None — every method returns 410 Gone | n/a | No | [`app/api/webhooks/provider/route.ts:60`](../../app/api/webhooks/provider/route.ts#L60) | VERIFIED_RETIRED |
| `/api/webhooks/provider` | DELETE | RETIRED | None — every method returns 410 Gone | n/a | No | [`app/api/webhooks/provider/route.ts:64`](../../app/api/webhooks/provider/route.ts#L64) | VERIFIED_RETIRED |
| `/api/webhooks/shift4` | GET | PUBLIC | None — unauthenticated liveness probe (health check), not the intake path | None needed: returns a fixed `{ok, provider, endpoint}` label and reads no data | No | [`app/api/webhooks/shift4/route.ts:5`](../../app/api/webhooks/shift4/route.ts#L5) | VERIFIED_PUBLIC |
| `/api/webhooks/shift4` | POST | PROVIDER_WEBHOOK | `verifyWebhook` returns **false** in production, so every delivery 401s (fail-closed pending Shift4's documented contract) | n/a while fail-closed | Yes | [`app/api/webhooks/shift4/route.ts:9`](../../app/api/webhooks/shift4/route.ts#L9) | VERIFIED |
| `/api/webhooks/solana` | POST | PROVIDER_WEBHOOK | Alchemy HMAC-SHA256 over the raw body, `verifyHexHmac` constant-time; 401 when the key is unset | Provider pinned by route; activity matched to payments by address in the Engine | Yes | [`app/api/webhooks/solana/route.ts:54`](../../app/api/webhooks/solana/route.ts#L54) | VERIFIED |
| `/api/webhooks/speed` | GET | PUBLIC | None — unauthenticated liveness probe (health check), not the intake path | None needed: returns a fixed `{ok, provider, endpoint}` label and reads no data | No | [`app/api/webhooks/speed/route.ts:9`](../../app/api/webhooks/speed/route.ts#L9) | VERIFIED_PUBLIC |
| `/api/webhooks/speed` | POST | PROVIDER_WEBHOOK | Svix HMAC over the raw body inside `processWebhook`; 400 on failure | Provider pinned by route; Speed account matched server-side | Yes | [`app/api/webhooks/speed/route.ts:13`](../../app/api/webhooks/speed/route.ts#L13) | VERIFIED RA-6 |
| `/api/webhooks/stripe` | GET | PUBLIC | None — unauthenticated liveness probe (health check), not the intake path | None needed: returns a fixed `{ok, provider, endpoint}` label and reads no data | No | [`app/api/webhooks/stripe/route.ts:6`](../../app/api/webhooks/stripe/route.ts#L6) | VERIFIED_PUBLIC |
| `/api/webhooks/stripe` | POST | PROVIDER_WEBHOOK | Stripe `constructEvent` HMAC over the raw body + timestamp tolerance, inside `processWebhook` | Provider pinned by route; rail correlation in `eventProcessor` | Yes | [`app/api/webhooks/stripe/route.ts:10`](../../app/api/webhooks/stripe/route.ts#L10) | VERIFIED |
| `/api/woocommerce/plugin/download` | GET | DASHBOARD_SESSION | `requireMerchantIdFromRequest` (Supabase JWT or `pt_live_` key) | Merchant id from the verified token; never from the body | No | [`app/api/woocommerce/plugin/download/route.ts:13`](../../app/api/woocommerce/plugin/download/route.ts#L13) | VERIFIED |
## 6. Findings

Eleven findings, **one remediated (RA-1, 2026-08-06)**. The rest remain open and
each is prioritized for a separate surgical task. No claim is made that any of
these was exploited; each states its preconditions.

A resolved finding keeps its entry rather than being deleted: the row it came
from still references the id so the decision stays traceable from the matrix.

| ID | Severity | Status | Route(s) | Defect |
|---|---|---|---|---|
| RA-1 | **CRITICAL** | **Resolved 2026-08-06** | `GET /api/pos/terminal-session` | Minted a 24h terminal session with no authentication |
| RA-2 | **HIGH** | **Resolved 2026-08-06 — route retired** | `POST /api/shopify/session` | Was unauthenticated and unsigned; the caller selected the merchant *and* supplied the order payload |
| RA-4 | **HIGH** | **Resolved 2026-08-06** | `POST /api/pos/base-session/[intentId]` | Terminal-session claims were discarded; cross-merchant service-role write |
| RA-3 | MEDIUM | Open | `GET /api/payment-intents/[intentId]` | Discloses the whole intent row, including `pinetree_fee` and `merchant_id` |
| RA-7 | MEDIUM | Open | `POST /api/webhooks/lightning` | Returns 200 after a post-verification failure, suppressing provider retry |
| RA-11 | MEDIUM | Open | `POST /api/wallet-connect-session` | Unauthenticated mutation (previously accepted risk; re-stated, not re-decided) |
| RA-5 | LOW | Open | `POST /api/debug/{base,lightning,solana,solflare}` | Deny-list environment guard |
| RA-9 | LOW | Open | `POST /api/pos/terminal-session` | PIN-recovery path has no rate limiter |
| RA-6 | LOW | Open | `POST /api/webhooks/speed` | Parses and queries the database before verification |
| RA-8 | LOW | Open | cron + internal routes | Non-constant-time secret comparison; `CRON_SECRET` doubles as `INTERNAL_API_SECRET` |
| RA-10 | LOW | Open | `GET /api/payments/status` | 500 path echoes the internal error message |

---

### RA-1 — CRITICAL — unauthenticated terminal-session minting — **RESOLVED 2026-08-06**

**Route:** `GET /api/pos/terminal-session?tid=<terminalId>`

The defect and its remediation are both recorded here. The narrative below is in
the past tense because the behavior no longer exists; see **Resolution** at the
end of this entry for the current contract.

**Execution chain (before the fix)**

1. [`proxy.ts:15-25`](../../proxy.ts#L15) — `/api/pos/` is not in `isProtectedApi`, so the request was not challenged globally. *(Still true; the route now needs no global challenge because it issues nothing.)*
2. `app/api/pos/terminal-session/route.ts` — the handler read `tid` and called the display engine with **no** authentication, authorization, rate limit, or PIN check.
3. `engine/posTerminalSession.ts` — the display projection called `signTerminalSession(terminal.merchant_id, terminal.id)`.
4. The signed token was returned in the response body as `sessionToken`.
5. [`lib/api/terminalAuth.ts:38-47`](../../lib/api/terminalAuth.ts#L38) — that token is a valid `pts_` credential with a **24-hour** TTL, exactly what `requireTerminalSession` accepts.

**Preconditions.** Knowledge of one terminal UUID. It is not publicly
enumerable (v4 random) and the `/terminal` page itself *is* proxy-protected, but
the id travels as `?tid=` in the POS device's URL
(`app/(pos)/terminal/TerminalInnerr.tsx:49` — not linked because the route-group parentheses break relative-link resolution),
so it is present in browser history, screenshots, and shoulder-surfing range on
a shared counter device. No credential is needed.

**Impact.** The PIN gate at `POST /api/pos/terminal-auth` — including its
5-attempts-per-15-minutes limiter — is fully bypassed, because this route hands
out the very token the PIN is supposed to purchase. A `pts_` token is accepted by
**30 route+method pairs** (31 counting the `/api/payments/create` alias),
including card-present money movement and provider configuration:

- `POST /api/payments/stripe/manual` and `POST /api/payments/stripe/terminal` — Stripe card authorization
- `POST /api/pos/shift4-manual-authorization` — Shift4 card authorization
- `POST /api/pos/payment`, `POST /api/payments`, `POST /api/pos/card/payment-link`
- `POST /api/payments/[paymentId]/fail` — a canonical state transition
- `POST /api/pos/drawer/{open,sale}` — cash-drawer mutations
- `POST /api/providers/stripe/terminal/{locations,readers/register,readers/default}` — provider configuration

`requireStripeCardMerchant` ([`lib/api/stripeTerminalAuth.ts:9-16`](../../lib/api/stripeTerminalAuth.ts#L9))
maps a `pts_` token to `{merchantId: claims.mid}`, so on those routes the token
carries **merchant-level** authority. The response additionally discloses
`merchant_id`, drawer balance, tax configuration, and terminal name.

**Runtime evidence required:** no. The chain was complete in source.

> The remediation originally sketched here proposed issuing the token from the
> PIN-verified path. That was implemented and then corrected: it made the PIN an
> *entry* gate, which contradicts PineTree's terminal product contract. The
> **Resolution** below is the authoritative account — the defect was credential
> issuance without *authentication and ownership*, and that is what was fixed.

**Resolution — 2026-08-06**

What closes RA-1 is a **verified merchant session plus a server-side ownership
check**, not a PIN prompt. Terminal id possession is not authorization; a
credential is minted only for a caller PineTree has already authenticated and
that provably owns the terminal.

The PIN is unchanged in strength but changed in role: it is the **exit** gate.
Launching a configured terminal opens the POS immediately, which is PineTree's
intended terminal behavior — a cashier does not authenticate to start selling.

- **Launch.** `GET /api/pos/terminal-session` requires
  `requireMerchantIdFromRequest`. The `/terminal` page is proxy-protected
  ([`proxy.ts:10-11`](../../proxy.ts#L10)), so the cashier's browser already holds
  a merchant session, which the client forwards as a bearer token.
- **Ownership.** [`launchPosTerminalEngine`](../../engine/posTerminalSession.ts)
  loads the terminal by id and requires `terminal.merchant_id` to equal the
  session-derived merchant id **before** signing. A terminal owned by another
  merchant returns 404, so the route cannot enumerate terminal ids. `db` is the
  service-role client, so this comparison — not row-level security — is what
  enforces tenancy. No `merchantId` from query or body is consulted.
- **Single minting site.** `signTerminalSession` is called in exactly one place,
  inside that ownership-checked function. The token keeps its `mid`/`tid` claims
  and 24-hour TTL.
- **Exit.** [`POST /api/pos/terminal-exit-auth`](../../app/api/pos/terminal-exit-auth/route.ts)
  requires the active `pts_` session **and then** the PIN: 4-digit format check,
  server-side verification, and a 5-per-15-minute limiter keyed on the terminal id
  from the signed claims. Because identity comes from those claims, a PIN can only
  exit the terminal it was issued for, and the route cannot be used to test PINs
  against arbitrary terminal ids. It returns `{ exitAuthorized: true }` and
  **never** a credential — a successful exit check can never become a
  replacement session.
- **Retired.** `POST /api/pos/terminal-auth` returns 410. It was the last endpoint
  that minted a merchant-scoped credential from an unauthenticated request holding
  only a terminal id and a 4-digit secret, and after this change nothing called it.
- **Client.** The POS renders as soon as the authenticated launch succeeds, and
  nothing renders before it. A failed launch shows an error rather than retrying
  without credentials. The exit PIN dialog opens only from the lock/exit control,
  the credential is retained on a wrong PIN, and it is cleared only after the
  server authorizes the exit.
- **Refresh.** Re-running the authenticated launch restores the POS for as long as
  the merchant session is valid; there is no manual unlock step.

**Verified by**
[`__tests__/posTerminalCredentialIssuance.test.ts`](../../__tests__/posTerminalCredentialIssuance.test.ts):
an unauthenticated launch returns 401 with no token and never reaches the signer;
an authenticated owner launch returns a `pts_` whose claims carry the verified
merchant and terminal, with no PIN anywhere in the exchange; a foreign terminal is
refused 404 with nothing signed, including when `merchantId` is supplied in the
query; refresh re-launches successfully; the launched token is accepted by a
protected POS route while a merchant JWT is not; the exit route rejects a missing
or forged session, a wrong PIN, and malformed PINs, stays rate-limited, and on
success returns no credential; and the retired route answers 410.

---

### RA-2 — HIGH — unauthenticated Shopify session creation with caller-selected merchant — **RESOLVED 2026-08-06 (route retired)**

**Route:** `POST /api/shopify/session`

The narrative below is in the past tense; see **Resolution** for the current
contract.

**Execution chain (before the fix)**

1. [`proxy.ts:15-25`](../../proxy.ts#L15) — `/api/shopify/` is not protected globally. *(Still true; the route now answers 410 before doing anything.)*
2. The body was parsed and shape-validated. There was **no** Shopify HMAC check, no app-proxy signature check, and no merchant authentication anywhere in the file.
3. `getActiveShopifyConnection(ctx.shop)` resolved the merchant **from the request body**.
4. `createCheckoutSessionEngine` was called with that merchant id and the caller's `amount`, `currency`, `orderId`, `customerEmail`, `successUrl`, `cancelUrl`, and `metadata`.

**Preconditions.** Knowledge of a connected store's `myshopify.com` domain,
which is public information.

**Impact.** Any internet caller can create real PineTree checkout sessions
against any connected merchant, choosing the amount and currency, and can obtain
a `checkoutUrl` on PineTree's own domain whose `successUrl`/`cancelUrl` point
wherever they like — a credible phishing primitive that also pollutes the
merchant's session records and order references. It does not by itself confirm a
payment or move funds, which is why this is HIGH rather than CRITICAL.

**Why this is clearly an omission.** The sibling routes verify properly:
[`app/api/shopify/webhooks/route.ts:27`](../../app/api/shopify/webhooks/route.ts#L27)
calls `verifyShopifyWebhook`, and
[`app/api/shopify/auth/callback/route.ts:38`](../../app/api/shopify/auth/callback/route.ts#L38)
calls `verifyShopifyOAuthCallback`. The helper exists and is simply not applied here.

**Runtime evidence required:** no.

**Resolution — 2026-08-06: the route is retired (410 Gone).**

**Why a signature was not enough.** An App Proxy signature check was implemented
first and did close merchant selection. It was rejected as a resolution because it
verifies the wrong half of the request. Shopify signs the proxied **query string
only** — it does not sign app-proxy request bodies — so `totalPrice`, `currency`,
order identity, customer email, and `successUrl`/`cancelUrl` all remained fully
caller-controlled, and the signed `timestamp` carries no nonce, so a request could
be replayed inside its freshness window. A verified store identity over an
unverified financial payload is not an acceptable contract for a route that
creates checkout sessions, and marking it resolved would have overstated the
protection. The store-identity fix is retained in history, not in the runtime.

**Current behavior.** [`app/api/shopify/session/route.ts`](../../app/api/shopify/session/route.ts)
exports only `POST`, which returns **410** with a fixed body and `Cache-Control:
no-store`. It performs no work at all: no signature parsing, no body read, no
`getActiveShopifyConnection`, no `validateShopifyOrderContext` /
`buildPineTreeSessionParams`, no database access, and no
`createCheckoutSessionEngine` call. Retirement does not depend on configuration —
there is no 503 path and no 401 path left, so no request shape can reach the
engine. The response contains no secret, signature, order, shop, or merchant
information.

**Dead code removed.** `verifyShopifyAppProxySignature` was deleted from
[`integrations/shopify/lib/hmac.ts`](../../integrations/shopify/lib/hmac.ts)
along with the route that was its only caller, rather than kept as dead security
code that a future reader might mistake for an active boundary. A comment records
why it is absent and what the construction was. `verifyShopifyWebhook` and
`verifyShopifyOAuthCallback` are **unchanged**, and the corresponding class
`PLATFORM_SIGNED` is removed from §2 because no route now uses it.

**Nothing was broken.** No in-repo caller exists — the storefront/payment
extension is documented in
[`integrations/shopify/README.md`](../../integrations/shopify/README.md) as not
built or published from this repository. Shopify OAuth install, callback,
disconnect, status, and webhook behavior are unchanged and continue to verify as
before.

**Requirements for reactivation.** Verifying the shop is necessary but not
sufficient. A future implementation must also obtain the authoritative order
amount, currency, order identity, and customer information **server-side** — by
retrieving the order from Shopify's Admin API with the stored access token, or
through another equally trusted server-side contract. Storefront-supplied body
values must never carry financial, merchant, or redirect authority.

**Verified by**
[`__tests__/shopifySessionVerification.test.ts`](../../__tests__/shopifySessionVerification.test.ts):
unsigned, correctly signed app-proxy-style, wrong-secret, malformed-body, and
missing-configuration requests all return 410; the original exploit shape (signed
shop A with `body.shop` = shop B) returns 410; no Shopify connection lookup, order
validation, database call, or checkout-session creation occurs on any path; the
response leaks no secret, signature, shop, amount, or customer email and is
`no-store`; only `POST` is exported; and `verifyShopifyAppProxySignature` is no
longer exported while the webhook and OAuth verifiers still are.
[`__tests__/shopifyWiringRoutes.test.ts`](../../__tests__/shopifyWiringRoutes.test.ts)
asserts a storefront-supplied order body creates nothing, and
[`__tests__/routeAuthMatrixCoverage.test.ts`](../../__tests__/routeAuthMatrixCoverage.test.ts)
pins this row as the route's only row, `RETIRED` / `VERIFIED_RETIRED`, and greps
the handler to confirm it still calls none of the removed work.

---

### RA-4 — HIGH — cross-merchant write on the POS Base session — **RESOLVED 2026-08-06**

**Route:** `POST /api/pos/base-session/[intentId]`

The narrative below is in the past tense; see **Resolution** for the current
contract.

**Execution chain (before the fix)**

1. `requireTerminalSession(req)` was called **and its return value discarded**. The claims (`mid`, `tid`) were never bound to anything.
2. The intent was loaded by id alone.
3. Both writes used `supabaseAdmin` (service role, so row-level security cannot compensate) scoped `.eq("id", id)` only.

The file contained **zero** references to `merchantId`, `merchant_id`, or
`claims`, which was the direct evidence that no ownership comparison existed.

**Preconditions.** Any valid `pts_` terminal session (from any merchant — and
per RA-1 obtainable without a PIN) plus knowledge of a target intent UUID.

**Impact.** A terminal belonging to merchant A can overwrite or clear
(`clear: true`) the `pos_base_session` metadata on merchant B's payment intent.
The mutable fields include `pairingUri`, validated only by a `wc:` prefix
([`…:85`](../../app/api/pos/base-session/[intentId]/route.ts#L85)). The public
`GET` mirror on the same route
([`…:21-56`](../../app/api/pos/base-session/[intentId]/route.ts#L21)) serves
that value to the paying customer's hosted checkout, so an attacker can
substitute their own WalletConnect pairing URI into a victim merchant's live
sale, or disrupt sales by clearing the session mid-payment, or display a false
`txHash`/`step`.

**Runtime evidence required:** no.

**Resolution — 2026-08-06**

The claims are retained and are the only identity source:
`const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)`. No
merchant or terminal id is read from the body, the query, or intent metadata.

Ownership is enforced at three deliberately overlapping layers, because the route
uses the service-role client and so cannot rely on row-level security:

1. **Merchant-scoped read.** `getPaymentIntentForMerchant(id, merchantId)`
   ([`database/paymentIntents.ts`](../../database/paymentIntents.ts)) puts
   `merchant_id` in the query and returns null for both a missing and a foreign
   intent, so the response is an indistinguishable 404 either way and the id
   cannot be used to probe existence.
2. **Explicit invariant.** `String(intent.merchant_id) !== merchantId` → 404,
   asserted after the read so a future refactor that widens the query cannot
   silently widen access.
3. **Scoped writes.** Both `supabaseAdmin` updates now carry
   `.eq("merchant_id", merchantId)` alongside `.eq("id", id)`.

**Terminal binding.** POS-created intents record the creating terminal
(`engine/paymentIntents.ts` sets `terminal_id` from the terminal claims), so a
populated `terminal_id` must equal `claims.tid` — one terminal cannot drive
another terminal's sale. Intents created outside the POS (hosted checkout, public
API) have `terminal_id` null; those remain merchant-scoped only, because there is
no binding to enforce and refusing them would break the legitimate flow where a
terminal presents a non-POS intent. Both branches are tested.

All checks run **before** any write, so an ownership failure performs no database
mutation. `GET` is unchanged: it is an intentionally public mirror for the
customer's hosted checkout with a safe-field allowlist, and RA-4 concerned `POST`.
Base transaction construction, WalletConnect behavior, amounts, network
selection, fee capture, and state-machine semantics are untouched.

**Verified by**
[`__tests__/posBaseSessionOwnership.test.ts`](../../__tests__/posBaseSessionOwnership.test.ts)
(20 tests): a missing or forged token is refused with no write; a foreign intent
is refused 404 **even when its `terminal_id` matches the caller's**, which
isolates the merchant guard from the terminal guard; `clear: true` cannot wipe a
foreign intent; a same-merchant intent bound to another terminal is refused; a
null-`terminal_id` intent is allowed for the owning merchant and refused for
another; both writes are asserted to carry `{ id, merchant_id }`; body-supplied
`merchant_id`/`terminal_id` are ignored; and the valid same-merchant flow still
merges onto the existing session and preserves unrelated metadata. Removing the
two merchant guards fails 4 of those tests.

---

### RA-3 — MEDIUM — full payment-intent row disclosed publicly

**Route:** `GET /api/payment-intents/[intentId]`

**Execution chain.**
[`app/api/payment-intents/[intentId]/route.ts:36`](../../app/api/payment-intents/[intentId]/route.ts#L36)
returns `{ ...intent, checkoutToken }`, spreading the entire row loaded by
[`database/paymentIntents.ts:63-72`](../../database/paymentIntents.ts#L63)
(`select("*")`). Per
[`database/paymentIntents.ts:7-22`](../../database/paymentIntents.ts#L7) that
includes `merchant_id`, `pinetree_fee`, `terminal_id`, and arbitrary `metadata`.

**Preconditions.** Possession of the intent UUID. The paying customer
legitimately holds it, so this is disclosure to a semi-trusted party rather than
to the whole internet.

**Impact.** PineTree's per-transaction fee, the merchant's internal UUID, the
terminal id, and whatever the merchant put in `metadata` (potentially order or
customer detail) are exposed to anyone holding a checkout link. The previous
matrix asserted this route returns "no internal sensitive data" — **that claim
was false**, which is why it is recorded here rather than silently corrected.

**Recommended remediation.** Return an explicit safe-field allowlist, mirroring
the pattern already used by `GET /api/payments/[paymentId]`
([`app/api/payments/[paymentId]/route.ts:27-36`](../../app/api/payments/[paymentId]/route.ts#L27)).

**Tests the remediation must add** — response contains no `merchant_id`, no
`pinetree_fee`, no `terminal_id`, and no raw `metadata`; hosted checkout still
receives every field it needs (`available_networks`, `amount`, `currency`,
`status`, `expires_at`, `checkoutToken`).

---

### RA-7 — MEDIUM — verified Lightning event acknowledged after a processing failure

**Route:** `POST /api/webhooks/lightning`

A signature failure correctly returns 400. Any *other* error after successful
verification is caught and answered `{ received: true, processed: false }` with
the default **200** status
([`app/api/webhooks/lightning/route.ts`](../../app/api/webhooks/lightning/route.ts),
final catch). The sibling `/api/webhooks/speed` returns **500** for the same
condition so Speed retries.

**Impact.** A transient database or engine failure on a genuine, verified
payment event is acknowledged, so the provider never redelivers and the payment
can remain unconfirmed while the customer has paid. This is a durability and
money-visibility defect, not an authentication bypass — recorded here because it
contradicts the stated rule in
[`webhook-verification-fail-closed.md`](./webhook-verification-fail-closed.md#rejected-non-2xx-behavior)
that PineTree does not return 200 to suppress retries.

**Recommended remediation.** Return 5xx for post-verification failures, matching
`/api/webhooks/speed`.

**Tests the remediation must add** — a verified payload whose engine call throws
yields 5xx and no acknowledgement; an invalid signature still yields 400; a
verified, successfully-applied payload still yields 200.

---

### RA-11 — MEDIUM — unauthenticated wallet-connect session mutation

**Route:** `POST /api/wallet-connect-session`

`GET` and `DELETE` require merchant auth; `POST` remains open so wallet return
pages (which run without auth context) can post a wallet address. Possession of
the `crypto.randomUUID()` session id is the capability. Existing mitigations:
status is restricted to `pending`/`connected`, the id is format- and
length-validated, and the merchant must still click **Save** behind merchant auth
before any address is persisted to provider configuration.

This was reviewed and accepted in the 2026-05-19 audit. It is restated here for
completeness, **not** re-decided: an unauthenticated mutation belongs in this
list even when the residual risk was knowingly accepted. Any change is an owner
decision.

---

### RA-5 — LOW — deny-list environment guard on four debug routes

`POST /api/debug/{base,lightning,solana,solflare}` guard with
`process.env.NODE_ENV === "production"` → 404
([`app/api/debug/solana/route.ts:4`](../../app/api/debug/solana/route.ts#L4) and
the three siblings). Because the test is a deny-list, an unset or unexpected
`NODE_ENV` leaves the route reachable. All four are **log-only sinks**: they
`console.log` a caller-supplied stage and payload, return `{ ok: true }`, read no
data, and mutate nothing. Worst case is server-log injection or flooding.
Next.js sets `NODE_ENV=production` during `next build`/`next start`, so the
practical exposure is small.

**Recommended remediation.** Invert to an allow-list
(`NODE_ENV === "development"`), or delete the routes — they carry no production
value.

---

### RA-9 — LOW — no rate limiter on the PIN-recovery path

`POST /api/pos/terminal-session` resets a terminal PIN after verifying a recovery
phrase ([`app/api/pos/terminal-session/route.ts:54-80`](../../app/api/pos/terminal-session/route.ts#L54)
→ `resetPosTerminalPinWithRecoveryEngine`,
[`engine/posTerminals.ts:100`](../../engine/posTerminals.ts#L100)). Unlike the PIN
login path — which uses a 5-per-15-minute limiter
([`app/api/pos/terminal-auth/route.ts:21`](../../app/api/pos/terminal-auth/route.ts#L21)) —
this route has no limiter, so recovery-phrase guessing is unthrottled. A
high-entropy phrase keeps this LOW, and the route issues no session token.

**Recommended remediation.** Apply the existing `makeRateLimiter` keyed on
terminal id, as the login path already does.

**Tests the remediation must add** — repeated wrong recovery phrases return 429
after the threshold; a correct phrase still resets the PIN.

Distinct from RA-1: RA-1 concerns the `GET` on this path, which needs no
credential at all. The `POST` does authenticate, via the recovery phrase.

---

### RA-6 — LOW — parse and database read before verification on the Speed webhook

[`app/api/webhooks/speed/route.ts:21-40`](../../app/api/webhooks/speed/route.ts#L21)
parses the JSON body and, for connected-account shapes, calls
`getMerchantIdBySpeedAccountId(accountId)` **before**
[`…:43`](../../app/api/webhooks/speed/route.ts#L43) hands the raw body to
`processWebhook`, where verification actually happens. Verification still covers
`rawBody`, so signature integrity is intact and no state changes; only two
booleans are logged and nothing is returned to the caller. The defect is
ordering: an unauthenticated request drives a database lookup.

**Recommended remediation.** Move the connected-account identification after
`processWebhook` returns, or verify first and reuse the verified payload.

---

### RA-8 — LOW — secret comparison and key separation on cron/internal routes

Every cron and internal route fails closed when its secret is unset, which is
correct. Two defence-in-depth gaps remain:

1. Comparison is `authorization === \`Bearer ${secret}\`` — an ordinary
   short-circuiting string compare rather than `timingSafeEqual`
   ([`app/api/cron/check-payments/route.ts:10`](../../app/api/cron/check-payments/route.ts#L10),
   [`app/api/internal/wallets/pinetree/debug-profile/route.ts:9`](../../app/api/internal/wallets/pinetree/debug-profile/route.ts#L9)).
   Remote timing attacks on a high-entropy static secret across a network are
   impractical, so this is LOW, but the repository already has the correct
   primitive in `equalSecret` and `verifyHexHmac`.
2. Six internal routes accept `CRON_SECRET` **or** `INTERNAL_API_SECRET`
   interchangeably, so the value shared with the platform scheduler also unlocks
   withdrawal reconciliation and Speed connect operations. Prefer distinct
   secrets per capability.

Also noted, not a finding: `POST /api/internal/wallets/pinetree/reconcile-withdrawals`
accepts an optional `body.merchantId`, letting a secret holder target any
merchant. That is intended operator behavior and reconciliation still requires
real provider evidence
([`app/api/internal/wallets/pinetree/reconcile-withdrawals/route.ts:21-28`](../../app/api/internal/wallets/pinetree/reconcile-withdrawals/route.ts#L21)).

---

### RA-10 — LOW — internal error message echoed

[`app/api/payments/status/route.ts`](../../app/api/payments/status/route.ts)
returns `error.message` in its 500 branch on an unauthenticated route, which can
surface a database or engine detail. Sibling public routes already return a fixed
string. Return a generic message and log the detail.

---

### Corrections to the previous matrix

The 2026-05-19 document contained claims this audit disproves:

| Previous claim | Reality |
|---|---|
| `/api/cron/update-balances` — "dev backdoor when no secret set" | **Fails closed.** A missing `CRON_SECRET` is logged and the request is rejected 401 ([`route.ts:8-21`](../../app/api/cron/update-balances/route.ts#L8)). |
| `GET /api/payment-intents/[intentId]` — "no internal sensitive data" | False — spreads the whole row (finding RA-3). |
| `GET /api/pos/terminal-session` — "Returns safe display info only (terminal name/state)" | Was false at audit time — it also returned a valid 24h `pts_` session token (finding RA-1). The claim became true on 2026-08-06 when RA-1 was fixed. |
| `/api/debug/lightning-balance` listed as MERCHANT | Route no longer exists. |
| 88 routes, "not a complete inventory" | 253 files / 308 handlers, now complete. `/api/cron/cleanup-api-idempotency` and ~165 other routes were absent. |

## 7. Runtime verification queue

Items that static analysis cannot settle. None is a claim of protection.

| Item | Why static analysis is insufficient | How to settle it |
|---|---|---|
| Production environment variables (`CRON_SECRET`, `INTERNAL_API_SECRET`, `TERMINAL_SESSION_SECRET`, `CHECKOUT_SESSION_SECRET`, `ALCHEMY_WEBHOOK_SIGNING_KEY_*`, `SHOPIFY_CLIENT_SECRET`, `PINETREE_NATIVE_CLIENT_SECRET`, `SHIFT4_OPERATOR_EMAIL`) | Code fails closed when they are unset, so absence degrades availability rather than security — but which are actually set is a deployment fact | Inspect the deployment environment; confirm each guarded route returns 401/403 rather than 200 |
| Supabase row-level-security policy contents | Policies live in the database, not the repository. Routes using `supabaseAdmin` bypass RLS entirely, so their safety rests on the ownership checks traced above, not on RLS | Export the live policy set and confirm no route depends on an RLS policy that does not exist |
| `NODE_ENV` in the production deployment (RA-5) | The guard is a deny-list | Probe `POST /api/debug/solana` in production; expect 404 |
| Shift4 webhook signature contract | `verifyWebhook` returns `false` pending Shift4's documented scheme, so the route 401s every delivery. Whether Shift4 is sending anything is external | Confirm with Shift4, then implement and re-audit |
| Provider-side replay windows for Speed/Svix and MoonPay | Tolerances are enforced inside provider SDK/adapter code | Integration test with a stale timestamp |
| `/api/v1` scope enforcement end to end | Scope strings are checked in code; whether issued keys carry least privilege is data | Audit `merchant_api_keys` permissions in the live database |

## 8. Maintenance rules

1. **A new `app/api/**/route.ts` file requires a matrix row per exported method,
   in the same commit.** `__tests__/routeAuthMatrixCoverage.test.ts` fails
   otherwise.
2. **A new exported method on an existing route requires its own row.** Methods
   are never collapsed into a wildcard when their behavior differs.
3. **Moving or renaming a route requires updating its row**, including the
   evidence link.
4. **Changing a shared helper in §3 requires re-auditing every row that cites
   it.** Helper changes are the highest-leverage way to invalidate this document.
5. **Provider webhook changes require a Standard 05 review** and an update to
   [`webhook-verification-fail-closed.md`](./webhook-verification-fail-closed.md).
   Verification must stay fail-closed: an adapter without `verifyWebhook` is
   refused, and only a strict `true` is accepted.
6. **Never mark a row `VERIFIED` from a path or filename.** Trace the guard, cite
   the line, and separate authentication from authorization.
7. **Do not narrow a `FINDING` to `VERIFIED` without the remediation and its
   tests** landing in the same commit.
8. Authorization for a service-role (`supabaseAdmin`) query must be proven in the
   route or engine, because row-level security cannot apply.

## 9. Authoritative references

| Reference | Owns |
|---|---|
| [`docs/standards/04-database-identity-security.md`](../standards/04-database-identity-security.md) | Identity, tenancy, and security rules |
| [`docs/standards/01-platform-architecture.md`](../standards/01-platform-architecture.md) | The `Interface → API → Engine → Adapter → Rail` boundary |
| [`docs/standards/05-provider-connectors-events.md`](../standards/05-provider-connectors-events.md) | Provider adapter and event-processing contract |
| [`webhook-verification-fail-closed.md`](./webhook-verification-fail-closed.md) | The fail-closed webhook decision and the retired generic route |
| [`docs/api/authentication.md`](../api/authentication.md) · [`docs/api/api-keys.md`](../api/api-keys.md) | Public API credential contract |
| [`docs/api/openapi.yaml`](../api/openapi.yaml) | Machine-readable public API schemas |
