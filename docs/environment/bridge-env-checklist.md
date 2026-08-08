# Bridge (by Stripe) — environment & deployment checklist

Bridge provides stablecoin conversion and merchant settlement. It is **owned by
Stripe but is not Stripe Connect and is not the Stripe SDK**: it is a separate
REST API with its own credentials, customer objects, KYC/KYB, endorsements, and
webhook signing.

> **A merchant with an approved Stripe connected account is NOT approved by
> Bridge.** The two provider connections are stored, synchronized, and enabled
> independently. Nothing in the Bridge integration reads Stripe state.

> **Bridge is internal infrastructure, not a merchant-facing provider.**
> Merchants never connect, enable, disable, or manage Bridge, and it does not
> appear on the Providers page. Merchants complete one PineTree onboarding;
> PineTree submits automatically after consent and presents the result as
> PineTree business verification. See
> [`docs/onboarding/business-verification.md`](../onboarding/business-verification.md).
> This document is for **operators** configuring the deployment.

This deployment implements **merchant KYB onboarding and bank withdrawals**.
Bridge *payment acceptance* remains deliberately disabled — `createPayment`
fails closed, and the adapter declares no payment networks, so nothing can route
a customer payment through Bridge.

---

## 1. Environment variables

All are **server-only**. Never prefix any with `NEXT_PUBLIC_`, never commit a
real value, and never return one to a browser.

| Variable | Required | Purpose |
|---|---|---|
| `BRIDGE_ENVIRONMENT` | Yes | Exactly `sandbox` or `production`. **No default.** |
| `BRIDGE_API_KEY` | Yes | Sent in Bridge's documented `Api-Key` header. |
| `BRIDGE_BASE_URL` | No | Explicit host override. Must be https and must match the selected environment. |
| `BRIDGE_WEBHOOK_PUBLIC_KEY` | Yes (for webhooks) | PEM public key that verifies `X-Webhook-Signature`. May be stored as a **single line with escaped `\n`** — deployment variables cannot carry real newlines, so `getBridgeWebhookPublicKey` restores them. Both forms are regression-tested. |
| `BRIDGE_KYC_REDIRECT_URL` | Yes | Where Bridge returns the merchant's browser after hosted KYB. Point at a PineTree route (e.g. `/dashboard/wallet-setup?verification=returned`). |
| `BRIDGE_TIMEOUT_MS` | No | Request timeout, default `20000`. |
| `BRIDGE_CAPABILITY_ROLLOUT_ENABLED` | No | Set to exactly `false` to hold automatic capability activation back deployment-wide during a controlled rollout. Absent = enabled. |

### Environment selection is explicit and fails closed

| `BRIDGE_ENVIRONMENT` | Base URL used |
|---|---|
| `sandbox` | `https://api.sandbox.bridge.xyz/v0` |
| `production` | `https://api.bridge.xyz/v0` |
| unset / anything else | **Configuration error — no request is sent** |

There is no silent fallback in either direction. If `BRIDGE_BASE_URL` is set and
points at a sandbox host while `BRIDGE_ENVIRONMENT=production` (or the reverse),
startup of the Bridge boundary throws rather than "correcting" the mismatch.

### Obtaining credentials

- **Sandbox:** Bridge Dashboard → API keys (`?sandbox=true`). Bridge sandbox
  environments are created **per user**, not per developer account.
- **Production:** requires an approved Bridge developer account (see
  [§5 External dependencies](#5-external-dependencies)).

---

## 2. Database migrations

Both are forward-only, preserve every existing row, and **must be run manually**
in order.

```bash
# Supabase SQL editor, or:
psql "$SUPABASE_DB_URL" -f database/migrations/20260805120000_create_bridge_provider_connections.sql
psql "$SUPABASE_DB_URL" -f database/migrations/20260806120000_create_service_terms_acceptances.sql
psql "$SUPABASE_DB_URL" -f database/migrations/20260807120000_create_bridge_bank_withdrawal_foundation.sql
```

`20260807120000_create_bridge_bank_withdrawal_foundation.sql` adds everything
bank withdrawals need. It is additive and idempotent throughout:

1. Business Profile verification columns on `merchant_settings`.
2. `merchant_bank_destinations` — the merchant's bank payout destinations,
   holding the provider's external-account id and the **masked last four** only.
3. `merchant_bridge_liquidation_routes` — the permanent settlement routes.
4. Correlation columns on the **existing** `wallet_withdrawal_requests`. There is
   no second withdrawal ledger. `destination_kind` defaults to `'crypto'`, so
   every existing withdrawal keeps its current behavior by construction.
5. Widens the webhook inbox to the four subscribed event categories.

`20260806120000_create_service_terms_acceptances.sql` adds the append-only
consent table that gates all provider submission. It creates new objects only —
it never backfills consent, and it never mass-creates provider customers.

What it does:

1. Ensures `merchant_providers (merchant_id, provider)` is unique.
2. Adds a **partial unique index** on `credentials->>'bridge_customer_id'` for
   `provider = 'bridge'` — one Bridge customer can belong to exactly one
   PineTree merchant. Same for `bridge_kyc_link_id`.
3. Creates `bridge_webhook_events`, the immutable webhook inbox
   (`provider_event_id` unique = deduplication; `occurred_at` = ordering key).
4. Enables RLS and grants **service-role only** access.

Bridge state itself lives in `merchant_providers.credentials` (JSONB), matching
the Stripe Connect precedent — no overlapping per-provider table was added.

**Never stored:** the API key, the webhook public key, hosted `kyc_link` /
`tos_link` URLs, SSNs, EIN documents, identification images, beneficial-owner
documents, or raw Bridge request payloads. Only Bridge identifiers and
normalized statuses are persisted.

---

## 3. Bridge Dashboard webhook configuration (manual)

PineTree **does not auto-provision webhooks**. A Bridge webhook endpoint is a
per-developer-account setting, not a per-merchant one, so creating it from a
request path would race across deployments. `createWebhook` exists in the client
for one-time operator setup only.

1. Bridge Dashboard → **Webhooks** → **Add endpoint**.
2. URL: `https://<your-domain>/api/webhooks/bridge`
3. Subscribe to the **`customer`**, **`kyc_link`**, **`external_account`**, and
   **`liquidation_address.drain`** event categories.
   (Other categories are verified, acknowledged, and ignored.)
   Note that Bridge fires **no payment-related webhooks in sandbox**, which is
   why reconciliation — not the webhook — is what makes a payout outcome
   knowable.
4. Copy the endpoint's **public key** into `BRIDGE_WEBHOOK_PUBLIC_KEY`.
   It can also be read programmatically:

   ```ts
   import { fetchWebhookDetails } from "@/providers/bridge"
   const { data } = await fetchWebhookDetails({ webhookId: "wh_..." })
   // data.public_key -> paste into BRIDGE_WEBHOOK_PUBLIC_KEY
   ```

5. Repeat separately for sandbox and production — **the keys differ**.

### Signature contract implemented

| Property | Value |
|---|---|
| Header | `X-Webhook-Signature` |
| Format | `t=<timestamp>,v0=<base64 signature>` |
| Timestamp unit | **Milliseconds** |
| Signed string | `` `${timestamp}.${rawRequestBody}` `` |
| Algorithm | RSA with SHA-256 |
| Key format | PEM X.509 public key |
| Replay window | 10 minutes, enforced in **both** directions |

Verification runs against the **raw** body before any parsing. An invalid
signature, stale timestamp, or malformed body returns `400` so Bridge retries a
genuine delivery; PineTree returns `500` only when it could not durably store a
*verified* event.

---

## 4. Approval evidence

**A browser redirect back from the hosted KYB flow is not proof of approval.**
`BRIDGE_KYC_REDIRECT_URL` only returns the merchant to PineTree. Approval is
established exclusively by:

- `POST /api/onboarding/business-verification/refresh` (a Bridge status lookup), or
- a signature-verified Bridge webhook.

The Bridge-backed capability activates **automatically** — there is no merchant
enable step — once **all three** hold:

1. KYB cleared (customer `active` / KYC link `approved`),
2. Bridge terms accepted (`tos_status = approved`), and
3. the **`base`** endorsement is `approved`.

...and PineTree adds no administrator hold and the rollout flag is not
disabled. A merchant can neither activate early nor deactivate.

---

## 5. External dependencies

| Dependency | Status |
|---|---|
| Bridge **developer account approval** | **Required before production.** Bridge gates production API access; sandbox works without it. |
| Bridge production API key | Blocked on the above. |
| Webhook endpoint registration | Manual, per environment (§3). |
| Bridge payment/transfer contract | **Out of scope.** Payment acceptance is not enabled; Bridge never receives a customer payment. |
| Native ETH / SOL bank withdrawal | **Unavailable.** The settlement route receives USDC, and no conversion provider is integrated. Deliberately surfaced as unavailable rather than mis-routed. |
| End-to-end funds-to-bank verification | **Requires a low-value production UAT.** Bridge sandbox moves no real money, creates liquidation addresses as dummy data, and fires no payment webhooks. |

---

## 6. Go-live checklist

- [ ] `BRIDGE_ENVIRONMENT` set explicitly in every deployment target
- [ ] `BRIDGE_API_KEY` set (production key ≠ sandbox key)
- [ ] `BRIDGE_KYC_REDIRECT_URL` points at the PineTree wallet return route over https
      (`/dashboard/wallet-setup?verification=returned`) — never at the Providers page
- [ ] Migration `20260805120000_create_bridge_provider_connections.sql` applied
- [ ] Migration `20260806120000_create_service_terms_acceptances.sql` applied
- [ ] Migration `20260807120000_create_bridge_bank_withdrawal_foundation.sql` applied
- [ ] Bridge Dashboard webhook endpoint created for this environment
- [ ] Endpoint subscribed to `customer`, `kyc_link`, `external_account`, and
      `liquidation_address.drain`
- [ ] `BRIDGE_WEBHOOK_PUBLIC_KEY` copied from **that** endpoint
- [ ] `BRIDGE_CAPABILITY_ROLLOUT_ENABLED` set only if holding activation back
- [ ] Bridge developer account approved for production
- [ ] Confirmed no Bridge card appears on the merchant Providers page
- [ ] Confirmed the merchant sees exactly one Business Profile and one Withdraw
      experience — no second verification card, no provider connection step
- [ ] Sandbox merchant onboarded end to end (§7)
- [ ] Low-value production UAT completed (§8) — the only way to prove
      funds actually reach a bank

---

## 7. Sandbox acceptance test

Bridge sandbox creates customers via the API, simulates KYB approval, and
creates external accounts and liquidation addresses as **dummy data**. It moves
no real money, fires no payment webhooks, and Plaid does not work there. So the
sandbox proves the *integration*, never the *money movement*.

Do **not** send real Base or Solana funds to a sandbox liquidation address.

1. Complete **Settings → Business Profile** end to end and save.
2. Accept the service terms on the review-and-consent step.
3. Confirm exactly one Bridge customer exists
   (`GET /api/admin/business-verification?merchantId=…`).
4. Save the Business Profile again unchanged — no new customer, no update call.
5. Change one profile field and save — the **same** customer is updated.
6. `POST /api/admin/business-verification/simulate-approval` as an admin.
7. Refresh verification; PineTree projects **Verified**.
8. **PineTree Wallet → Withdraw → Bank account → Link bank account.** Confirm the
   response carries only a masked last four.
9. Start a Base USDC bank withdrawal to reach the review screen — this creates
   the Base settlement route.
10. Repeat on Solana USDC — this creates the Solana route.
11. Repeat either; the stored route is reused and no second route is created.
12. Confirm no raw account number or tax identifier appears in any database row
    or log line.
13. Replay a webhook with a bad signature (400) and with the configured PEM
    (accepted).
14. Replay the same event id twice — exactly one applied effect.
15. Deliver drain fixtures for every payout state and confirm the mapping.
16. Deliver an out-of-order drain and confirm it cannot regress newer state.
17. Confirm a source-chain transaction alone never marks a bank withdrawal
    Confirmed.
18. Confirm ordinary Base, Solana, Bitcoin, and card behavior is unchanged.

## 8. Production low-value UAT

Because sandbox cannot move money, the only proof that funds reach a bank is a
real, small production withdrawal:

1. Onboard one real business through the normal Business Profile flow and let
   verification approve genuinely.
2. Link one real US bank account.
3. Withdraw a **minimal** USDC amount on Base.
4. Confirm PineTree stays **Processing** after the source-chain transaction
   confirms — this is the behavior under test.
5. Confirm PineTree flips to **Confirmed** only when the payout completes, and
   that the money actually arrived.
6. Repeat once on Solana.
7. Reconcile the admin diagnostics against the Bridge Dashboard.
