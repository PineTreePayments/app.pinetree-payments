# Go-Live Checklist

Complete this checklist before accepting real payments in production.

---

## API Keys

- [ ] **Secret API key created** — in Dashboard → Developer → API Keys, with the minimal permissions your integration needs
- [ ] **API key stored in environment variables** — not in source code, not in a `.env` file committed to version control
- [ ] **Public browser key created** (if using Browser SDK or React SDK)
- [ ] **No `pt_live_*` keys in frontend code** — verify with a search of your codebase

---

## Webhook Endpoint

- [ ] **Webhook endpoint registered** in Dashboard → Developer → Webhooks
- [ ] **Endpoint uses HTTPS** — HTTP endpoints will not receive events in production
- [ ] **Webhook signing secret stored** in environment variables as `PINETREE_WEBHOOK_SECRET`
- [ ] **`PineTree-Signature` header is verified** on every incoming event using `constructEvent()` or manual HMAC verification
- [ ] **Timestamp tolerance enforced** — events older than 5 minutes are rejected (handled automatically by the Node SDK)
- [ ] **Duplicate event handling** — your handler uses `eventId` to deduplicate in case of retry

---

## Payment Flows Tested

- [ ] **Happy path**: checkout session created → customer pays → `payment.confirmed` event received → order fulfilled
- [ ] **Failed payment**: `payment.failed` event received → order not fulfilled, customer notified
- [ ] **Expired/incomplete session**: session expired → `payment.incomplete` event received → order not fulfilled
- [ ] **Canceled session**: `POST .../cancel` works and does not trigger fulfillment

---

## Idempotency

- [ ] **`Idempotency-Key` header set** on all `POST /api/v1/checkout/sessions` calls
- [ ] **Key is deterministic** (e.g., your order ID) — not a random UUID generated per retry
- [ ] **`409 idempotency_key_conflict` handled** — do not retry with a different body for the same key

---

## Reconciliation

- [ ] **Reports reviewed** in Dashboard → Reports to confirm amounts and fees
- [ ] **Ledger entries reconciled** — confirm total confirmed payments match expected revenue
- [ ] **Incomplete/failed payments tracked** — ensure these do not result in fulfilled orders

---

## Provider Credentials

- [ ] **At least one payment provider configured** — Solana, Base, Lightning, or Shift4
- [ ] **Provider credentials stored as environment variables** — not hardcoded
- [ ] **Treasury wallet addresses verified** — payments will be sent to these addresses

---

## Required Environment Variables

In production, these must be set or the engine will refuse to start:

```bash
CHECKOUT_SESSION_SECRET="..."       # Session token signing
TERMINAL_SESSION_SECRET="..."       # POS terminal session signing
SPEED_WEBHOOK_SECRET="..."          # If using Lightning via Speed
```

Set in your hosting provider's environment config (Vercel, Railway, etc.).

---

## Platform Validation

Run these before every production deployment:

```bash
npm run lint       # 0 errors
npm run typecheck  # 0 errors
npx vitest run     # 506 tests pass
npm run build      # clean production build
```

---

## Security Final Check

- [ ] No secret keys or webhook secrets in source code or frontend
- [ ] Webhook endpoint returns `2xx` quickly and processes events asynchronously
- [ ] Error responses from your webhook handler do not expose internal details
- [ ] `successUrl` and `cancelUrl` are on your own domain

---

## Support

If you encounter issues, include the `requestId` from error responses (also in `X-Request-Id` response header) when contacting support.
