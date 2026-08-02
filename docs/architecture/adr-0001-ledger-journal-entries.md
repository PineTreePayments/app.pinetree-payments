# ADR 0001 — PineTree Balanced Journal and Legacy Ledger Compatibility

- **Status:** Accepted (schema authored, **not yet executed by PostgreSQL**)
- **Date:** 2026-07-31
- **Scope:** Platform accounting foundation, introduced during Shift4 REST Phase 2

## Context

The Financial Ledger, Money, and Reconciliation Standard (v1.0) requires an
append-only journal with balanced postings: `ledger_accounts`,
`ledger_transactions`, ledger entries, and lifecycle links, with integer
minor/base units, deterministic unique posting keys, corrections made through new
reversing transactions, and the lifecycle transition and its posting committed in
one database transaction.

The repository does not have that. `public.ledger_entries` is a flat table with
one row per payment, keyed by a unique `payment_id`, carrying a single `amount`
and a `direction` string. It has no transaction grouping, no debit/credit sides,
no posting key, and no balance rule.

Shift4 split tender is what forced the issue. A partial authorization followed by
a second tender produces **two captures against one PineTree payment**. Two
captures are two distinct economic events and require two postings. A table that
permits one row per payment cannot represent them: posting one row understates
the money that moved, and posting none while confirming the payment confirms
unrecorded revenue. Both are worse than refusing, which is what the code did
before this work.

## Decision

Introduce a **generic, platform-wide** balanced journal:

| Table | Purpose |
|---|---|
| `public.ledger_accounts` | named accounts, unique by owner + account type + currency + network |
| `public.ledger_transactions` | one economic event, unique `posting_key` |
| `public.ledger_journal_entries` | debit/credit lines, `amount_minor > 0` |
| `public.ledger_links` | ties each posting to its lifecycle record |

It is deliberately **not** a Shift4 ledger. Base, Solana, Speed, Stripe, and
FluidPay can adopt it without schema change.

### Why `ledger_journal_entries` and not `ledger_entries`

Standard 03 names the entry entity `ledger_entries`. That name is already taken by
the legacy table, and renaming or dropping it would break every report that reads
it today. `ledger_journal_entries` is therefore the **canonical journal-entry
entity**, and `public.ledger_entries` is a **temporary legacy
compatibility/read-model table**. This ADR exists mainly to record that naming
divergence deliberately, so a future reader does not "fix" it by accident.

### Deterministic posting keys

- sale/capture ? shift4.<operation>.v1|<merchant_id>|<attempt_id>
- platform fee — `shift4.platform_fee.v1|<merchant_id>|<payment_id>`

A duplicate live response, a duplicate invoice lookup, and a recovery pass all
derive the same key and resolve to the same transaction. `post_ledger_transaction`
returns the existing transaction for an identical duplicate and **raises** on
conflicting reuse.

### Balance and immutability

Debits must equal credits **per currency** per transaction, enforced by a
`DEFERRABLE INITIALLY DEFERRED` constraint trigger so the check runs at COMMIT
once the whole line set exists, plus pre-write validation inside the posting
function. Mixed currencies cannot balance against each other because the sum is
grouped per currency.

`BEFORE UPDATE OR DELETE` triggers on `ledger_transactions`,
`ledger_journal_entries`, and `ledger_links` always raise, so history is
append-only even for a `SECURITY DEFINER` function running as the table owner.
Foreign keys use `ON DELETE RESTRICT` so a parent deletion cannot silently remove
financial lines. Corrections create a new reversing transaction pointing at the
original through `reversal_of_transaction_id`.

RLS is enabled with no policy; every journal table revokes all from `public`,
`anon`, `authenticated`, **and `service_role`**, then grants `service_role`
`SELECT` only. No role holds `INSERT`, `UPDATE`, or `DELETE`. All writes go
through `post_ledger_transaction`.

### Platform fee: once per payment

The $0.15 PineTree Platform Fee is charged **once per overall PineTree payment**,
not once per Shift4 capture.

Repository evidence is decisive: `engine/config.ts` defines
`PINETREE_FEE = 0.15` ("the standard fee charged per transaction");
`engine/createPayment.ts` applies it once and stores `payments.pinetree_fee`; the
customer sees one Platform Fee line. Split tender is a *method of satisfying one
PineTree payment*, not a reason to charge the customer twice.

The fee therefore posts as its **own** transaction keyed by payment id, rather
than being attached to whichever capture happened to be first:

```
capture      debit  provider clearing         G
             credit merchant gross receivable G

platform fee debit  merchant gross receivable 15
             credit platform fee receivable   15
```

Merchant net receivable settles at `sum(captures) − 15`. `pricing_version` is
recorded as `pinetree.standard.v1`.

### Legacy compatibility projection

`public.ledger_entries` is **not financial authority**. One row may be written per
payment, once, only after the payment reaches exact full capture, as an aggregate
projection so existing reports keep working. Never one row per capture.

## Consequences

- Split tender posts each settling sale/capture as its own balanced transaction;
  the payment confirms only when their exact sum reaches the locked payment total.
- Two accounting representations coexist until reporting cuts over. That is
  intentional debt, recorded here.
- The journal migration must run **before** the Shift4 migration; the filenames
  sort accordingly and the Shift4 preflight asserts the journal exists.

## Non-goals

- Migrating or back-filling existing `ledger_entries` history.
- Cutting reports over to the journal.
- Refund, dispute, settlement, or withdrawal postings.
- Adopting the journal in any other rail.
- Removing `public.ledger_entries`.

## Status caveat

Neither migration has been executed by PostgreSQL. There is no local database in
this environment, so every guarantee above is enforced by schema text that has
been read and contract-tested but never planned or run. **Do not treat this as
production-ready until both migrations execute against a real database and the
runtime assertions pass.**
