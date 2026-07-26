# Joshua Payment Cleanup Audit

Scope: Joshua's real merchant account only, resolved by normalized email
`joshuaduskin@outlook.com`.

No cleanup has been executed. The repo does not include the original DDL for the
core `payments`, `transactions`, `payment_events`, and `ledger_entries` tables,
so the FK/cascade behavior for those tables cannot be proven from source alone.
Run the companion read-only SQL first and use its FK output before authoring any
destructive cleanup script.

## Schema Map

| Table | PK | Merchant Ownership | Payment Relationship | Status Field | FK/Cascade Known From Repo |
| --- | --- | --- | --- | --- | --- |
| `public.payments` | `id` | `merchant_id` | Canonical payment record | `status` | Original table DDL not present |
| `public.transactions` | `id` | `merchant_id` | `payment_id` plus payment join in app queries | `status` | Original table DDL not present |
| `public.payment_events` | `id` | Via `payments.merchant_id` | `payment_id` | `event_type` | Original table DDL not present |
| `public.ledger_entries` | `id` | `merchant_id` | `payment_id`, `transaction_id` | `status` | Original table DDL not present |
| `public.payment_intents` | `id` | `merchant_id` | Nullable `payment_id` | `status` | Original table DDL not present |
| `public.idempotency_keys` | `key` or `id` | Via payment | `payment_id` | None | Original table DDL not present |
| `public.solflare_deeplink_sessions` | `id` | Via payment or intent | `payment_id`, `intent_id` | None | Original table DDL not present |
| `public.merchant_terminal_readers` | `id` | `merchant_id` | Nullable `active_payment_id` | `status` | `active_payment_id -> payments(id) ON DELETE SET NULL` |
| `public.lightning_payout_jobs` | `id` | `merchant_id` | `payment_id`, `transaction_id` | `status` | Migration includes columns, no payment FK found |
| `public.lightning_settlement_payout_jobs` | `id` | `merchant_id` | `payment_id`, `transaction_id` | `status` | Migration includes columns, no payment FK found |
| `public.merchant_lightning_sweeps` | `id` | `merchant_id` | `source_payment_id` | `status` | Migration includes column, no payment FK found |
| `public.support_tickets` | `id` | `merchant_id` | Nullable `related_payment_id` | `status` | Original FK not proven; do not delete support tickets |

Tables intentionally excluded from cleanup: auth users, `merchants`, provider
credentials, wallets, wallet operations, withdrawal tables, terminal inventory,
configuration, settlement preferences, and Shopify/configuration tables.

## Status Map

Preserve successful payments:
`CONFIRMED`, `SUCCESS`, `SUCCEEDED`, `COMPLETE`, `COMPLETED`, `PAID`.

Active payments:
`CREATED`, `PENDING`, `WAITING`, `AWAITING_CUSTOMER`,
`AWAITING_CONFIRMATION`, `PROCESSING`, `IN_PROGRESS`, `SETTLING`,
`SUBMITTED`, `SENT`.

Unsuccessful cleanup candidates, after merchant scoping and relation review:
`FAILED`, `ERROR`, `REJECTED`, `DECLINED`, `DENIED`, `INCOMPLETE`,
`ABANDONED`, `REQUIRES_ACTION`, `ACTION_REQUIRED`, `EXPIRED`, `TIMED_OUT`,
`TIMEOUT`, `CANCELED`, `CANCELLED`.

Refunds/legacy/unknown:
`REFUNDED` should be preserved/reviewed separately because it may represent a
real successful payment lifecycle. Any unrecognized raw status is manual review.

UI mapping is centralized in `lib/utils/paymentStatus.ts`; lifecycle conflict
resolution is in `lib/transactionDisplay.ts` and
`lib/utils/canonicalPaymentStatus.ts`.

## Read-Only Preview SQL

Use `database/diagnostics/20260726_joshua_payment_cleanup_readonly.sql`.
It returns:

- Joshua merchant row lookup
- Current payment status counts
- Core FK/cascade introspection for payment-related tables
- Candidate preview rows with related-row counts
- Candidate bucket totals
- Post-cleanup verification queries

## Cleanup Order, Pending FK Confirmation

Do not run destructive cleanup until FK/cascade introspection is reviewed. The
likely safe order, if FK output confirms no surprise cascades, is:

1. Backup/export Joshua-scoped candidate payment IDs and all related rows.
2. Release terminal reader claims that still point at approved candidate payments.
3. Delete non-financial dependent rows that only exist to support abandoned
   attempts, such as idempotency/deeplink rows, where FK behavior requires it.
4. Delete payment events for approved candidate payments only if the FK does not
   cascade and those events are not needed for audit retention.
5. Delete transactions for approved candidate payments only when they are not
   confirmed-like and have no provider/chain evidence.
6. Delete the approved candidate payments.
7. Verify no Joshua-scoped unsuccessful/stale rows remain in dashboard-visible
   queries, while confirmed/completed rows and all non-Joshua rows remain.

Rows with ledger entries, payout jobs, settlement jobs, lightning sweeps,
support tickets, confirmed-like transactions, provider transaction IDs, chain
hashes, or active terminal reader claims should be treated as manual review, not
automatic cleanup.

## Backup And Rollback Recommendation

Before any cleanup, export the preview result plus full rows from every related
table for the approved candidate IDs. The destructive script should run in one
transaction and default to `ROLLBACK` until the exact previewed IDs are approved.

Because the current repo cannot prove every production FK/cascade, no final
destructive cleanup SQL is included here. Run the read-only introspection SQL and
use its FK results to author the final transaction-wrapped cleanup script.
