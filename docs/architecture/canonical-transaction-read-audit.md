# Canonical transaction read audit

Date: 2026-07-28

## Decision

All merchant and admin transaction reads start at `payments` and project one
row per payment in `engine/canonicalTransactions.ts`. `payments.status` is the
only current lifecycle field. Related `transactions` provide deterministic
attempt/reference evidence; `payment_events` provide ordered audit history.
Neither relation can replace the lifecycle status. Refunds and disputes are
returned separately as `adjustmentStatus`.

The canonical identity is `paymentId`. `attemptId`, provider reference, and
transaction hash are secondary. Amount and occurrence time come from the
payment (`gross_amount`, then deterministic legacy fallbacks; `created_at`).
Merchant-local reporting boundaries come from `merchant_settings.timezone`.

## Conflicting reads found and replacements

| Surface | Previous read and conflict | Canonical read after repair | Scope / pagination / filters |
| --- | --- | --- | --- |
| Dashboard Overview – Recent Transactions | `/api/dashboard/overview` → `engine/dashboardOverview.ts`; started at `transactions`, joined `payments`, displayed transaction ID/status/time and sliced after an unbounded query. | `getAllCanonicalTransactions` → `toMerchantTransactionReadRow`; recent ten are sorted payment rows and aliases are derived only from canonical fields. | Required merchant scope; aggregate dataset is complete; today uses merchant-local boundaries. |
| Merchant Transactions | `/api/transactions` → `engine/transactionsDashboard.ts`; started at `transactions`, merged payment/transaction status, then replayed `payment_events` to relabel `INCOMPLETE` as canceled/expired. Cardinality was attempt-based. | `getCanonicalTransactionPage`; events remain timeline-only. | Required merchant scope; stable payment `created_at,id` order; server page/count and provider/network/status/rail/asset/currency/source/method/channel/date filters. |
| Reports listing and totals | `/api/reports` → `engine/reports.ts` → `database/reports.ts`; payment-root query chose arbitrary `transactions[0]`, allowed transaction `REFUNDED` to replace lifecycle, and formatted already-formatted rail values a second time. | `getAllCanonicalTransactions` → `buildReportLedgerRow`; totals and visible rows iterate the same filtered array. Refund/dispute stay adjustments. | Required merchant scope; merchant-timezone period; API pagination is applied only after totals; status filter uses canonical lifecycle (or explicit adjustment filter). |
| CSV / PDF / email | Reused report rows but CSV alone exposed payment ID; PDF used provider/reference as primary; PDF/email dates used server timezone. | Same report array for all exports; payment ID is primary, references are secondary, and all timestamps use the report merchant timezone. | Same merchant, period, and status filters as visible report. |
| Admin Transaction Explorer | `/api/admin/transactions` → `engine/adminTransactions.ts` → three independent database queries on `payments`; rows were raw and detail omitted attempt/hash evidence. UI also labeled `INCOMPLETE` as canceled. | Canonical page + complete canonical filtered set for summaries/distributions; canonical by-payment-ID detail plus raw audit events. | Admin scope, optional merchant scope; stable payment pagination and shared filters. |
| Admin Platform Reports | `/api/admin/reports` called `database/adminReports.getPlatformReport` directly, bypassing Engine. `INCOMPLETE` and canceled were not distinct. | `/api/admin/reports` → `engine/adminReports.getPlatformReportEngine` → canonical all-row read. | Admin scope; platform period and live/test mode; complete filtered dataset. |
| Merchant receipt HTML/PDF | `engine/receipts.ts` independently queried a payment and newest transaction, used fixed Chicago time, labeled attempt ID as transaction ID, and re-derived asset. | Canonical by-payment-ID row plus presentation settings; payment ID primary, attempt/reference secondary, canonical asset/status/amount/time. | Required merchant scope and `payments:read`; merchant timezone. |
| Shared transaction table/detail modal | Accepted competing legacy IDs/statuses and prioritized provider hashes in list cells. | Canonical fields are preferred; visible/navigation identity is payment ID and provider/attempt/hash values are explicit secondary fields. | No lifecycle inference in the component. |

## Production evidence

The three reported Base payment IDs have matching pre-repair
`payments.status=INCOMPLETE` and related `transactions.status=INCOMPLETE`.
Each has a later explicit `payment.canceled` / `terminal_cancel` event with
`merchant_canceled`, no stored transaction hash, and an expired intent:

- `d19a5d69-d8fd-4be5-847a-2dff21333f68`
- `35666a2b-708d-4303-b3d1-08d143bbbb3b`
- `0db25894-81ba-4e75-bce1-339b8159f9ab`

The event processor used to persist that explicit outcome as `INCOMPLETE`.
That write-side vocabulary collapse is the historical defect. After the
status-constraint migration, the bounded explicit-ID reconciliation command
repairs only `payments.status` to `CANCELED` by compare-and-set and appends a
`payment.reconciled` audit event. The linked transaction remains accounting
evidence and is not rewritten.

The legacy Lightning payment
`63b6b3c1-e586-4ff7-80ea-d95279b544f0` is locally `PENDING`. Its current
connected-account Speed lookup returns 404, while a platform-scoped lookup
returns the exact matching provider payment with matching PineTree payment and
merchant metadata and authoritative Speed status `expired`. It predates the
connected-account scoping change. The bounded reconciliation path therefore
uses platform fallback only after scoped 404, verifies all three identities,
records the evidence scope, and advances lifecycle to `EXPIRED` through the Engine. Generic
age-based maintenance now excludes Speed Lightning until that provider lookup
has run.

The production preflight found 111 payment rows: 103 `CONFIRMED`, one `FAILED`,
six `INCOMPLETE`, and one `PENDING`; there were no unknown lifecycle values.
`database/migrations/20260728_expand_payment_lifecycle_statuses.sql` therefore
can safely install the eight-value canonical constraint while failing closed
on any concurrent schema or vocabulary drift.

## Verification session 2026-07-28 (build gate and live read validation)

Deployed-schema defect found and fixed: the embedded attempt select asked for
`transactions.updated_at`, which the deployed `transactions` table does not
have (it records settlement as `completed_at`). PostgREST rejects the whole
query when an embedded column is unknown, so every canonical surface would have
returned a server error in production. The select now reads `completed_at`,
`canonicalAttemptSettledAt` resolves either column name, and
`canonicalTransactionDatabaseFilters` asserts the embedded select names only
columns the deployed table has.

Live read validation against production (read-only, all 111 payments):

- Canonical status counts equal the raw `payments.status` distribution exactly
  (103 CONFIRMED, 1 FAILED, 6 INCOMPLETE, 1 PENDING), so the projection adds no
  lifecycle reinterpretation.
- Transactions, Reports, Overview, Admin Explorer, and the paginated page agree
  on payment identity, status, asset, rail, amount, and timestamp; payment
  identities are unique and Overview is an exact prefix of Transactions.
- Reports ledger, CSV (111 rows, `payment_id` present), and PDF all derive from
  one summary object. Assets resolve to BTC/ETH/SOL/USD/USDC with no
  `Unknown asset`.

Remaining production work is blocked on database access, not on code. The
environment exposes only a PostgREST service-role key, so
`20260728_expand_payment_lifecycle_statuses.sql` cannot be applied and the
current status CHECK constraint cannot be introspected from here. Because the
event processor now persists `CANCELED` and `EXPIRED` — values production has
never stored — the migration must be applied before this code is deployed.
The bounded historical reconciliation of the three Base payments and the legacy
Lightning payment is gated behind that same migration.

## Invariants

- A late or duplicate event cannot change a read-time lifecycle state.
- `CANCELED`, `EXPIRED`, and `INCOMPLETE` remain distinct.
- Lightning always projects `rail=Bitcoin Lightning`, `network=Bitcoin Lightning`, `asset=BTC`.
- Base approval metadata cannot become the actual payment transaction hash.
- Merchant and admin results differ only by authorization scope.
- No ledger row is used as a payment lifecycle source and reconciliation does
  not create ledger entries.
