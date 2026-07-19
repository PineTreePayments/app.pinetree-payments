# Speed Connected-Account Wallet Contract

PineTree authenticates to Speed with its server-side platform API key. A
merchant is resolved from the authenticated PineTree request, then mapped to
`merchant_lightning_profiles.speed_account_id`. Every merchant-scoped Speed
request uses the canonical header:

```text
speed-account: acct_...
```

The browser never supplies or edits this identifier. Missing, malformed, or
conflicting account identity fails closed and never falls back to PineTree's
root Speed account.

## Confirmed API surface

| Operation | Speed endpoint | PineTree behavior |
|---|---|---|
| Balance | `GET /balances` | Live read, integer/base-unit normalization, account-scoped cached snapshot |
| Transactions | `GET /balance-transactions` | Cursor pagination with `limit` and `ending_before`; idempotent activity-ledger sync |
| Withdrawal | `POST /send` | User-triggered Instant Send after local operation creation and a fresh available-balance check |
| Withdrawal status | `GET /send/{id}` | `unpaid` → pending, `paid` → completed, `failed` → failed |
| Payment creation | `POST /payments` | Connected-account receive request scoped by the same header |

Connected accounts created by PineTree through Speed's API can send and
receive using PineTree's platform credentials. Funds remain hosted with Speed;
PineTree does not directly custody the connected account's BTC.

Speed does not currently expose AutoSwap or AutoPayout APIs. PineTree does not
simulate them, schedule Instant Send as AutoPayout, or expose interactive
configuration for those features.

## Environment

All values are server-only and must never use a `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
|---|---|
| `SPEED_API_KEY` | Platform Basic-auth credential. |
| `SPEED_WEBHOOK_SECRET` | Existing webhook signature verification secret. |
| `SPEED_CONNECT_ENABLED` | Enables PineTree-managed connected accounts. Must be exactly `true`. |
| `SPEED_LIGHTNING_SWEEP_ENABLED` | Separately enables automatic transfer of eligible receipts to a merchant's configured PineTree Wallet Lightning destination. |
| `SPEED_SWEEP_MIN_SATS` | Minimum net SATS eligible for a sweep (default `1`). |
| `SPEED_SWEEP_FEE_RESERVE_SATS` | SATS retained from an automatic sweep (default `0`). |
| `SPEED_SWEEP_MAX_ATTEMPTS` | Bounded automatic-sweep attempts (default `5`). |
| `SPEED_SWEEP_RETRY_BASE_SECONDS` | Base exponential-backoff delay (default `30`). |

There are no endpoint overrides, account-prefix flags, or wallet-capability
flags. Endpoint and header spelling are fixed in the shared provider client.

## Financial safeguards

- A local account-scoped operation and PineTree idempotency key are created
  before Instant Send dispatch.
- A duplicate request returns the existing operation and never sends again.
- PineTree does not claim provider idempotency because Speed's published
  Instant Send contract does not document it.
- A timeout after dispatch remains processing/uncertain and is reconciled by
  `GET /send/{id}`, webhook data when available, or transaction sync. It is not
  blindly retried.
- HTTP success is not itself settlement: only Speed `paid` is completed.
- Failed balance reads never overwrite the last successful snapshot with zero.
- Activity reconciliation uses Speed transaction ID plus provider account and
  merges related `pi_`/`wi_` source IDs with existing webhook/withdrawal rows.

## Automatic Lightning sweep

The separate `merchant_lightning_sweeps` state machine remains feature-flagged
because it automatically moves funds. It uses the same confirmed Balance and
Instant Send provider boundary, a compare-and-set claim, bounded attempts, and
a fresh BOLT11 invoice. A sweep is confirmed only by Speed `paid` or a verified
destination-wallet receipt.

No production validation should submit a real Instant Send. Use mocked provider
fixtures and read-only balance/transaction checks only.
