# PineTree API Route Auth Matrix

Audited 2026-05-19. Updated 2026-05-19 (Phase 3D). All routes under `app/api/**/route.ts` (88 total).

**Auth categories:**

| Symbol | Meaning |
|--------|---------|
| PUBLIC | Intentionally unauthenticated (payment flow, public data) |
| PCO | Checkout-scoped token (`pco_` prefix via `verifyCheckoutSession`) |
| PTS | Terminal-scoped token (`pts_` prefix via `requireTerminalSession` / `verifyTerminalSession`) |
| MERCHANT | Merchant JWT or API key via `requireMerchantIdFromRequest` |
| ADMIN | Admin JWT via `requireAdminFromRequest` |
| CRON | `Authorization: Bearer ${CRON_SECRET}` header |
| WEBHOOK | Provider HMAC signature (Alchemy / Speed) |
| PIN | POS PIN + brute-force protection (issues `pts_` token) |
| GAP | No auth — needs follow-up |

---

## Public — Payment Flow

These routes are intentionally unauthenticated. They serve payer-facing flows (wallet transactions, hosted checkout, blockchain interactions). They expose no sensitive merchant data.

| Route | Methods | Notes |
|-------|---------|-------|
| `/api/payments/status` | GET | Returns `{status, paymentId, intentId}` only |
| `/api/payments/[paymentId]` | GET | Sanitized fields only (Phase 1 hardening) |
| `/api/payment-intents/[intentId]` | GET | Issues `checkoutToken`; no internal sensitive data |
| `/api/payments/[paymentId]/detect` | POST | Triggers blockchain watcher; no state returned |
| `/api/solana-pay/transaction` | GET, POST | Solana Pay protocol; CORS open |
| `/api/solana/build-wallet-transaction` | POST | Payment flow |
| `/api/solana/unsigned-tx` | GET | Payment flow |
| `/api/payments/[paymentId]/base-usdc-v5/prepare` | POST | Payment flow |
| `/api/payments/[paymentId]/base-usdc-v5/relay` | POST | Payment flow |
| `/api/payments/[paymentId]/base-usdc-v5/delegated/prepare` | POST | Payment flow |
| `/api/payments/[paymentId]/base-usdc-v5/delegated/status` | GET | Payment flow |
| `/api/payments/[paymentId]/base-usdc-v5/allowance-check` | GET | Payment flow |
| `/api/payments/[paymentId]/base-usdc-v5/build-allowance-payment` | POST | Payment flow |
| `/api/payments/[paymentId]/base-usdc-v4/prepare-authorization` | POST | Payment flow |
| `/api/payments/[paymentId]/base-usdc-v4/relay` | POST | Payment flow |
| `/api/payments/[paymentId]/solflare/prepare` | POST | Payment flow |
| `/api/payments/[paymentId]/solflare/relay` | POST | Payment flow |

---

## Checkout-Scoped (PCO)

| Route | Methods | Auth | Notes |
|-------|---------|------|-------|
| `/api/payments/[paymentId]/fail` | POST | PCO or PTS or MERCHANT | Three-path: checkout token, terminal session, or merchant auth |
| `/api/payment-intents/[intentId]/select-network` | POST | PCO | `Authorization: Bearer <pco_token>` required; verifies `claims.iid === intentId`. Fixed Phase 3D. |

---

## Terminal-Scoped (PTS)

| Route | Methods | Auth | Notes |
|-------|---------|------|-------|
| `/api/pos/payment` | POST | PTS | `requireTerminalSession` |
| `/api/pos/methods` | GET | PTS | `requireTerminalSession` |
| `/api/pos/breakdown` | GET | PTS | `requireTerminalSession` |
| `/api/pos/drawer/open` | POST | PTS | `requireTerminalSession` |
| `/api/pos/drawer/sale` | POST | PTS | `requireTerminalSession` |

---

## Terminal-or-Merchant

| Route | Methods | Auth | Notes |
|-------|---------|------|-------|
| `/api/payments` | POST | PTS or MERCHANT | Creates a payment |
| `/api/payment-intents/[intentId]/cancel` | POST | PTS or MERCHANT | Cancels intent |
| `/api/pos/drawer/balance` | GET | PTS or MERCHANT | Drawer balance |

---

## PIN-Based (POS Bootstrap)

Auth not yet established when these are called; engine enforces brute-force protection.

| Route | Methods | Auth | Notes |
|-------|---------|------|-------|
| `/api/pos/terminal-session` | GET | None | Returns safe display info only (terminal name/state) |
| `/api/pos/terminal-session` | POST | PIN | PIN recovery via recovery phrase |
| `/api/pos/terminal-auth` | POST | PIN | PIN verification; issues `pts_` session token |

---

## Merchant-Authenticated

| Route | Methods | Auth |
|-------|---------|------|
| `/api/dashboard/overview` | GET | MERCHANT |
| `/api/settings` | GET, POST | MERCHANT |
| `/api/transactions` | GET, POST | MERCHANT |
| `/api/wallets/overview` | GET | MERCHANT |
| `/api/wallets/refresh` | POST | MERCHANT |
| `/api/off-ramp/support` | GET | MERCHANT |
| `/api/off-ramp/sessions` | GET, POST | MERCHANT. POST creates draft audit records only; no provider session or fund movement. |
| `/api/off-ramp/quote` | POST | MERCHANT. Quote only; no provider transaction, wallet signing, or fund movement. |
| `/api/off-ramp/sessions/[id]/prepare` | POST | MERCHANT. Prepares quote/session state only; no crypto broadcast or fund movement. |
| `/api/off-ramp/sessions/[id]/widget-url` | POST | MERCHANT. Prepares MoonPay widget URL only; no provider transaction settlement, wallet signing, crypto broadcast, or fund movement. |
| `/api/providers` | GET, POST | MERCHANT |
| `/api/reports` | GET | MERCHANT |
| `/api/reports/pdf` | GET | MERCHANT |
| `/api/reports/download` | GET | MERCHANT |
| `/api/reports/email` | POST | MERCHANT |
| `/api/checkout-links` | GET, POST | MERCHANT |
| `/api/checkout-links/[id]` | GET | MERCHANT |
| `/api/checkout/stats` | GET | MERCHANT |
| `/api/checkout/session` | POST | MERCHANT |
| `/api/merchant/webhooks` | GET, POST | MERCHANT |
| `/api/merchant/api-keys` | GET, POST | MERCHANT |
| `/api/merchant/api-keys/[id]` | GET, DELETE | MERCHANT |
| `/api/merchant/webhook-deliveries` | GET | MERCHANT |
| `/api/payment-readiness` | GET | MERCHANT |
| `/api/debug/lightning-balance` | GET | MERCHANT |
| `/api/admin/me` | GET | MERCHANT (own profile) |
| `/api/wallet-connect-session` | GET, DELETE | MERCHANT | Dashboard wallet-setup polling (GET) and cleanup (DELETE). Fixed Phase 3E. |
| `/api/support/tickets` | GET, POST | MERCHANT |
| `/api/support/tickets/[ticketId]` | GET, PUT | MERCHANT |
| `/api/support/tickets/[ticketId]/messages` | GET, POST | MERCHANT |
| `/api/support/feedback` | GET, POST | MERCHANT |
| `/api/help/assistant` | POST | MERCHANT |
| `/api/help/assistant/context-debug` | GET | MERCHANT |
| `/api/pos/drawer/closeout` | POST | MERCHANT |

---

## Admin-Only

| Route | Methods | Auth |
|-------|---------|------|
| `/api/admin/overview` | GET | ADMIN |
| `/api/admin/stale-payments` | GET | ADMIN |
| `/api/admin/stale-payments/mark-incomplete` | POST | ADMIN |
| `/api/admin/stale-payments/preview-mark-incomplete` | POST | ADMIN |
| `/api/admin/transactions` | GET | ADMIN |
| `/api/admin/transactions/[id]` | GET | ADMIN |
| `/api/admin/reports` | GET | ADMIN |
| `/api/debug/solana-wallet-strategy` | GET, POST | ADMIN |
| `/api/debug/lightning-wallet-strategy` | GET, POST | ADMIN |
| `/api/debug/base-pay-strategy` | GET, POST | ADMIN |
| `/api/debug/payment-environment` | GET | ADMIN |
| `/api/debug/payment-flow-state/[paymentId]` | GET | ADMIN |
| `/api/debug/base-payment/[paymentId]` | GET | ADMIN |
| `/api/validate` | POST | ADMIN |
| `/api/admin/support/tickets` | GET, POST | ADMIN |
| `/api/admin/support/tickets/[ticketId]` | GET | ADMIN |
| `/api/admin/support/tickets/[ticketId]/reply` | POST | ADMIN |
| `/api/admin/support/tickets/[ticketId]/status` | PATCH | ADMIN |
| `/api/admin/support/feedback` | GET | ADMIN |

---

## Disabled in Production (return 404)

| Route | Notes |
|-------|-------|
| `/api/debug/solana` | Returns 404 in non-development |
| `/api/debug/base` | Returns 404 in non-development |
| `/api/debug/lightning` | Returns 404 in non-development |
| `/api/debug/solflare` | Returns 404 in non-development |

---

## Service / Webhook-Signed

| Route | Methods | Auth | Notes |
|-------|---------|------|-------|
| `/api/webhooks/base` | POST | WEBHOOK (Alchemy HMAC `x-alchemy-signature`) | Do not change per Phase 3C constraints |
| `/api/webhooks/solana` | POST | WEBHOOK (Alchemy HMAC `x-alchemy-signature`) | Do not change per Phase 3C constraints |
| `/api/webhooks/lightning` | POST | WEBHOOK (Speed HMAC via adapter `verifyWebhook`) | Do not change per Phase 3C constraints |
| `/api/webhooks/provider` | POST | WEBHOOK (delegates to `processWebhook` → adapter `verifyWebhook`) | No explicit route-level sig check; security depends on engine |
| `/api/cron/check-payments` | GET | CRON (`CRON_SECRET` bearer) | Scheduled cron **removed from vercel.json** (Phase 3C). Route kept for manual use. Rejects if `CRON_SECRET` not set. |
| `/api/cron/update-balances` | GET | CRON (`CRON_SECRET` bearer) | Not scheduled; dev backdoor when no secret set |

---

## Needs Follow-up (GAP)

Routes with no authentication that accept mutations or manage session state. Remaining items not yet fixed.

| Route | Methods | Gap | Risk | Suggested Fix |
|-------|---------|-----|------|---------------|
| `/api/wallet-connect-session` | POST | Unauthenticated (see detail below) | Status-restricted; session_id is unguessable UUID | Accept for now; see detail below |
| `/api/shift4/apply` | POST | No auth | Starts Shift4 merchant onboarding with just an email | Add MERCHANT auth |
| `/api/oaut/coinbase/callback` | GET | OAuth callback (expected) | Path typo (`oaut` vs `oauth`); token read but **not stored** | Fix typo; implement token storage |

### wallet-connect-session POST — Remaining exposure and why it stays open

**Fixed in Phase 3E:** GET and DELETE now require merchant auth. The dashboard polling (GET) and session cleanup (DELETE) are fully gated.

**Remaining:** POST is open to the return pages (`solana-return`, `base-return`) which run in popup windows with no auth context. The session_id is the capability proof:

- Created by the merchant dashboard with `crypto.randomUUID()` (2^122 bits of entropy)
- Passed to the mobile wallet return page via deeplink URL params
- Only the holder of the session_id can POST a wallet address update

**Residual risk:** If the QR code / deeplink URL is intercepted, an attacker could POST a different wallet address to the session. Mitigations already in place:
1. Status is restricted to `"pending"` | `"connected"` — arbitrary injection blocked
2. session_id is validated against format/length
3. The merchant must still click **Save** in the dashboard (protected by merchant auth) before any address is persisted to provider config

`base-return` is explicitly labeled as LEGACY / disconnected from the current Base Pay flow and does not represent an active attack surface.

**Hardening applied in Phase 3D/3E:** session_id format+length validation; status allowlist; GET + DELETE behind merchant auth.

---

## Cron Schedule Change (Phase 3C)

`vercel.json` previously scheduled `/api/cron/check-payments` daily at midnight (`0 0 * * *`).

This was **removed** per the architecture preference: payment monitoring is webhook/detect-driven, not cron-driven. The route code is preserved and protected by `CRON_SECRET`. Re-enable by restoring the `crons` block to `vercel.json` if needed.
