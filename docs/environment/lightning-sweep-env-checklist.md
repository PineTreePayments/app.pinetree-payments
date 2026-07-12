# Automatic Lightning Sweep Environment Checklist

After a merchant receives a confirmed Lightning payment settled into their
Speed Custom Connect account balance, PineTree automatically transfers the
eligible net SATS to a fresh BOLT11 invoice from the same merchant's
PineTree Wallet, via Speed Instant Send. This is a foundation feature: the
full state machine, database layer, webhook trigger, and admin tooling are
implemented and shipped, but the live outbound send is feature-flagged and
fails closed until Speed supplies its exact API contract.

## What Speed has confirmed

- PineTree can programmatically send SATS from a Custom Connect merchant
  account to a BOLT11 Lightning invoice using PineTree's platform API key.
- Connected-account context is supplied via `X-Speed-Account:
  {connected_account_id}`.
- This supports balances below Speed's $20 automatic-payout minimum.

## What Speed has NOT yet confirmed

Do not guess any of the following - see
`providers/lightning/speedInstantSend.ts`:

- The Instant Send endpoint URL, HTTP method, and request body schema.
- The response schema.
- The balance endpoint.
- The idempotency header or request field.
- Whether `X-Speed-Account` expects the `ca_` relationship id or the
  `acct_` connected-account id (both are already retained separately - see
  `providers/lightning/speedHeaderAccountResolver.ts`).
- Success/failure event names.

## Required variables

All server-only. Never prefix with `NEXT_PUBLIC_`, never return them from an
API route, never log them.

| Variable | Purpose |
|---|---|
| `SPEED_LIGHTNING_SWEEP_ENABLED` | Must be exactly `true` to allow ANY outbound Speed Instant Send call. Defaults to disabled. |
| `SPEED_INSTANT_SEND_ENDPOINT` | Placeholder. Leave empty until Speed confirms the exact endpoint. |
| `SPEED_CONNECTED_BALANCE_ENDPOINT` | Placeholder. Leave empty until Speed confirms the exact endpoint. |
| `SPEED_HEADER_ACCOUNT_ID_PREFIX` | Placeholder (e.g. `ca_` or `acct_`). Leave empty until Speed confirms which identifier `X-Speed-Account` expects. |
| `SPEED_SWEEP_MIN_SATS` | Minimum net SATS eligible to queue a sweep (default `1`). |
| `SPEED_SWEEP_FEE_RESERVE_SATS` | SATS withheld from every sweep as a fee reserve (default `0`). |
| `SPEED_SWEEP_MAX_ATTEMPTS` | Attempts before a retryable failure becomes final (default `5`). |
| `SPEED_SWEEP_RETRY_BASE_SECONDS` | Base delay for exponential backoff between send attempts (default `30`). |

Setting only `SPEED_LIGHTNING_SWEEP_ENABLED=true` does **not** enable live
sends - the adapter still fails closed until the endpoint contract is
implemented in code (see below).

## Operational states

Every sweep lives in `merchant_lightning_sweeps.status`:

| Status | Meaning |
|---|---|
| `queued` | Created, not yet processed. |
| `awaiting_configuration` | Blocked on Speed's send-side configuration (feature flag, endpoint, or the `X-Speed-Account` identifier/prefix). |
| `awaiting_balance` | Speed reports the connected account doesn't yet have enough available balance. |
| `awaiting_invoice` | Blocked on the merchant's PineTree Wallet Lightning receive capability (see below). |
| `invoice_created` | A fresh BOLT11 invoice has been generated and is still valid. |
| `sending` / `processing` | A live send has been submitted; awaiting confirmation. |
| `confirmed` | Confirmed by a provider result or a verified destination-wallet receipt. Terminal. |
| `retryable_failed` | A send attempt failed but attempts remain; will retry after backoff. |
| `failed` | Exhausted attempts or a deterministic rejection. Terminal, but an admin can requeue it. |
| `canceled` | Canceled by an admin before it was ever sent. Terminal. |

`queued`/`awaiting_configuration`/`awaiting_balance`/`awaiting_invoice`/
`invoice_created`/`retryable_failed` are the only statuses a processing pass
will pick up automatically.

## Retry behavior

- Bounded exponential backoff from `SPEED_SWEEP_RETRY_BASE_SECONDS`, capped
  at 1 hour, up to `SPEED_SWEEP_MAX_ATTEMPTS`.
- `attempt_count` is incremented only immediately before a real Speed
  Instant Send call - waiting on missing configuration, an invoice, or
  balance never consumes an attempt.
- A compare-and-set claim (`status = 'processing' WHERE status IN
  (claimable states)`) guarantees only one processor can advance a given
  sweep at a time.
- An expired invoice is always replaced with a fresh one before the next
  send attempt - a sweep never resends to a dead BOLT11 invoice.

## PineTree Wallet invoice generation

PineTree Wallet (the Dynamic-embedded custodial wallet) has no native BOLT11
receive capability yet. `engine/pineTreeWalletLightningInvoice.ts` uses the
one real, already-working invoice-generation mechanism in this codebase -
NWC (Nostr Wallet Connect, "Bring Your Own Lightning Wallet") - when a
merchant has a connected, ready NWC wallet. A merchant without one sits in
`awaiting_invoice` rather than receiving a fabricated invoice.

## Processing triggers (no Vercel cron)

- Immediately after a verified `payment.paid` Speed webhook queues a sweep
  (bounded, deferred via `after()` - never inside the webhook response).
- On a merchant's PineTree Wallet page load, only when that merchant
  actually has a sweep due for another attempt (one indexed lookup; never
  unconditional).
- An explicit admin retry action.

There is no client-side polling and no dashboard-wide interval anywhere in
this feature.

## Ledger treatment

`merchant_lightning_sweeps` is itself the authoritative, reconciliation-ready
record of the outbound movement - it is never written into the shared
`ledger_entries` table (which has a unique constraint on `payment_id` and
already holds the original inbound payment's entry). A sweep is never marked
`confirmed` merely because Speed accepted the send request; confirmation
requires either a confirmed provider result or a verified destination-wallet
receipt (an NWC `lookup_invoice` showing the invoice settled).

## Testing procedure

```bash
npx vitest run __tests__/lightningSweep*.test.ts __tests__/speedInstantSend.test.ts __tests__/speedHeaderAccountResolver.test.ts __tests__/pineTreeWalletLightningInvoice.test.ts __tests__/adminLightningSweepsRoutes.test.ts
npx vitest run
npx tsc --noEmit
npx eslint <changed files>
npm run build
```

Confirm specifically: no test ever causes an HTTP request to a guessed Speed
endpoint (mock `global.fetch`/the HTTP layer and assert zero calls for the
Instant Send adapter's tests), and the underlying Lightning payment remains
`CONFIRMED` even when every sweep attempt fails.
