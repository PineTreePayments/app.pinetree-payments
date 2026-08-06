# ADR 0002 — Canonical Transaction Reads Start at `payments`

- **Status:** Accepted
- **Date:** 2026-07-28 (decision) · recorded as an ADR 2026-08-06
- **Scope:** Merchant and admin transaction reads, reporting projections
- **Supersedes:** `docs/architecture/canonical-transaction-read-audit.md`, whose
  decision and invariants this ADR preserves. That document also contained dated
  production evidence and a verification-session log, which were implementation
  narrative rather than contract and were not carried forward.

## Context

Merchant and admin transaction views could be assembled from three different
relations — `payments`, `transactions`, and `payment_events` — and different code
paths had begun reading different ones as the lifecycle source. That produces the
failure this platform cannot tolerate: the same payment rendering a different
state depending on which query served the page.

## Decision

All merchant and admin transaction reads start at `payments` and project one row
per payment in `engine/canonicalTransactions.ts`.

- `payments.status` is the **only** current lifecycle field.
- Related `transactions` provide deterministic attempt/reference evidence;
  `payment_events` provide ordered audit history. **Neither relation can replace
  the lifecycle status.**
- Refunds and disputes are returned separately as `adjustmentStatus`, never folded
  into the payment lifecycle.
- The canonical identity is `paymentId`. `attemptId`, provider reference, and
  transaction hash are secondary.
- Amount and occurrence time come from the payment (`gross_amount`, then
  deterministic legacy fallbacks; `created_at`).
- Merchant-local reporting boundaries come from `merchant_settings.timezone`.

## Invariants

- A late or duplicate event cannot change a read-time lifecycle state.
- `CANCELED`, `EXPIRED`, and `INCOMPLETE` remain distinct.
- Lightning always projects `rail=Bitcoin Lightning`, `network=Bitcoin Lightning`,
  `asset=BTC`.
- Base approval metadata cannot become the actual payment transaction hash.
- Merchant and admin results differ only by authorization scope.
- No ledger row is used as a payment lifecycle source, and reconciliation does not
  create ledger entries.

## Consequences

- `engine/canonicalTransactions.ts` is the single projection point; a new
  transaction surface consumes it rather than writing its own query.
- Adding a lifecycle-looking column to `transactions` does not make it a lifecycle
  source. Changing the lifecycle source requires superseding this ADR.

## Relationship to the standards

This ADR is authority **level 3** — it implements, and does not override,
[Standard 02](../standards/02-lifecycle-and-merchant-status.md) (canonical states
and the merchant projection) and
[Standard 03](../standards/03-financial-ledger-money-reconciliation.md) (the
payments table is not the ledger). See
[`docs/standards/README.md`](../standards/README.md) for the authority order.
