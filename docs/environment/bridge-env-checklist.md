# Bridge (by Stripe) — environment & deployment checklist

Bridge provides stablecoin conversion and merchant settlement. It is **owned by
Stripe but is not Stripe Connect and is not the Stripe SDK**: it is a separate
REST API with its own credentials, customer objects, KYC/KYB, endorsements, and
webhook signing.

> **A merchant with an approved Stripe connected account is NOT approved by
> Bridge.** The two provider connections are stored, synchronized, and enabled
> independently. Nothing in the Bridge integration reads Stripe state.

This phase implements the **onboarding and connection foundation only**. Bridge
payment creation is deliberately not enabled — `createPayment` fails closed.

---

## 1. Environment variables

All are **server-only**. Never prefix any with `NEXT_PUBLIC_`, never commit a
real value, and never return one to a browser.

| Variable | Required | Purpose |
|---|---|---|
| `BRIDGE_ENVIRONMENT` | Yes | Exactly `sandbox` or `production`. **No default.** |
| `BRIDGE_API_KEY` | Yes | Sent in Bridge's documented `Api-Key` header. |
| `BRIDGE_BASE_URL` | No | Explicit host override. Must be https and must match the selected environment. |
| `BRIDGE_WEBHOOK_PUBLIC_KEY` | Yes (for webhooks) | PEM public key that verifies `X-Webhook-Signature`. |
| `BRIDGE_KYC_REDIRECT_URL` | Yes | Where Bridge returns the merchant's browser after hosted KYB. |
| `BRIDGE_TIMEOUT_MS` | No | Request timeout, default `20000`. |

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

## 2. Database migration

`database/migrations/20260805120000_create_bridge_provider_connections.sql`

**Must be run manually.** It is forward-only and preserves every existing
provider row.

```bash
# Supabase SQL editor, or:
psql "$SUPABASE_DB_URL" -f database/migrations/20260805120000_create_bridge_provider_connections.sql
```

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
3. Subscribe to the **`customer`** and **`kyc_link`** event categories.
   (Other categories are verified, acknowledged, and ignored.)
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

- `POST /api/providers/bridge/sync` (a Bridge status lookup), or
- a signature-verified Bridge webhook.

A merchant may enable Bridge only once **all three** hold:

1. KYB cleared (customer `active` / KYC link `approved`),
2. Bridge terms accepted (`tos_status = approved`), and
3. the **`base`** endorsement is `approved`.

---

## 5. External dependencies

| Dependency | Status |
|---|---|
| Bridge **developer account approval** | **Required before production.** Bridge gates production API access; sandbox works without it. |
| Bridge production API key | Blocked on the above. |
| Webhook endpoint registration | Manual, per environment (§3). |
| Bridge payment/transfer contract | **Out of scope for this phase.** Payment creation is not enabled. |

---

## 6. Go-live checklist

- [ ] `BRIDGE_ENVIRONMENT` set explicitly in every deployment target
- [ ] `BRIDGE_API_KEY` set (production key ≠ sandbox key)
- [ ] `BRIDGE_KYC_REDIRECT_URL` points at the deployed providers page over https
- [ ] Migration `20260805120000_create_bridge_provider_connections.sql` applied
- [ ] Bridge Dashboard webhook endpoint created for this environment
- [ ] `BRIDGE_WEBHOOK_PUBLIC_KEY` copied from **that** endpoint
- [ ] Bridge developer account approved for production
- [ ] Sandbox merchant onboarded end to end (see the manual test checklist)
