# PineTree Standards — Authority Hierarchy

This directory holds the six canonical PineTree architecture standards. Before
this directory existed, these documents lived outside the repository while
migrations, engine code, tests, and ADR-0001 already cited them as binding
authority. They are now readable in-repo so that any contributor or coding agent
can actually comply with them.

All six are **Version 1.0, Effective July 25, 2026**, authority
"PineTree architecture source of truth".

## The six standards

| # | Standard | Scope |
|---|---|---|
| 01 | [Platform Architecture Standard](./01-platform-architecture.md) | System boundaries, invariants, authority matrix, Engine responsibilities |
| 02 | [Lifecycle and Merchant Status Standard](./02-lifecycle-and-merchant-status.md) | Payment/withdrawal/refund/dispute/settlement state machines and merchant projection |
| 03 | [Financial Ledger, Money, and Reconciliation Standard](./03-financial-ledger-money-reconciliation.md) | Append-only journal, integer money, idempotent fee posting, reconciliation |
| 04 | [Database, Identity, and Security Standard](./04-database-identity-security.md) | Data domains, tenancy, RLS, keys/secrets, indexing, audit |
| 05 | [Provider Connector and Event Processing Standard](./05-provider-connectors-events.md) | Adapter contract, maturity levels, normalized events, exactly-once effect |
| 06 | [Technical Roadmap and Documentation Governance](./06-roadmap-documentation-governance.md) | Delivery sequence, definition of done, documentation hierarchy, change control |

## Authority order

This ordering is not invented here. It restates
[Standard 06 §5 "Documentation hierarchy"](./06-roadmap-documentation-governance.md#5-documentation-hierarchy),
which is itself normative.

| Level | Artifact | Role |
|---|---|---|
| 1 | [Platform Architecture Standard](./01-platform-architecture.md) | System-wide authority and invariants |
| 2 | Domain standards 02–06 in this pack | Lifecycle, ledger, data/security, providers/events, governance |
| 3 | Accepted ADRs — [`docs/architecture/`](../architecture/) | Approved deviations and irreversible/local decisions |
| 4 | Executable interface truth — [`docs/api/openapi.yaml`](../api/openapi.yaml), [`database/migrations/`](../../database/migrations/), provider contracts | What the system actually exposes and stores |
| 5 | Runbooks, test plans, presentation references — [`docs/environment/`](../environment/), [`docs/api/`](../api/) | Operational and presentation guidance |
| 6 | Task prompts and agent instructions — [`AGENTS.md`](../../AGENTS.md), [`.ai/`](../../.ai/) | Surgical implementation instructions; never override levels 1–4 |

A lower level never silently overrides a higher one. A task prompt cannot
authorize breaking an invariant in Standard 01.

## Where `docs/architecture.md` sits

[`docs/architecture.md`](../architecture.md) predates this directory and remains
valuable and heavily cited by source code. Treat it as a **repository-level
restatement of Standards 01 and 02**, subordinate to them, with one exception:
its `Background Jobs (AUTHORITATIVE)` section covers scheduler inventory that
none of the six standards address, and remains authoritative for that topic.

Where `docs/architecture.md` and a standard appear to disagree, the standard wins
on precedence — but see the disagreement rule below before changing anything.

## When code and a standard disagree

Every standard carries this interpretation rule verbatim:

> If code and this standard disagree, the disagreement must be logged and
> deliberately resolved; neither is silently treated as correct.

Operationally, that means:

1. **Stop.** Do not edit the code to match the standard, and do not edit the
   standard to match the code.
2. **Report** the disagreement in your final output, naming the file, line, and
   the specific clause.
3. Resolution is a deliberate decision by the repository owner — recorded either
   as an ADR under [`docs/architecture/`](../architecture/) or as an amendment to
   the standard with a new version and effective date.

[ADR-0001](../architecture/adr-0001-ledger-journal-entries.md) is the worked
example: it records a deliberate naming divergence from Standard 03 rather than
silently "fixing" either side.

## Divergence register

Known, currently-unresolved differences between these standards and the
repository. Listed so they are not rediscovered as surprises, and not silently
resolved by an agent. **None of these are defects to fix without a decision.**

| # | Standard clause | Repository state | Status |
|---|---|---|---|
| D-1 | [Standard 03 §2](./03-financial-ledger-money-reconciliation.md#2-ledger-model) names the entry entity `ledger_entries` | Canonical journal entity is `ledger_journal_entries`; `public.ledger_entries` is a legacy flat compatibility table | **Resolved & accepted** in [ADR-0001](../architecture/adr-0001-ledger-journal-entries.md) |
| D-2 | [Standard 02 §3](./02-lifecycle-and-merchant-status.md#3-merchant-payment-projection) requires an `Unmapped → Unknown` projection with neutral gray and a diagnostic alert | `lib/utils/paymentStatus.ts` has no `Unknown` label; `displayToneForStatus` **throws** on an unmapped value | **Open** — needs a deliberate decision |
| D-3 | [Standard 03](./03-financial-ledger-money-reconciliation.md) and [ADR-0001](../architecture/adr-0001-ledger-journal-entries.md) describe the balanced journal as the accounting authority | Neither journal migration has been executed against PostgreSQL (see the ADR's "Status caveat") | **Open** — schema authored, not live |
| D-4 | [Standard 03 §1](./03-financial-ledger-money-reconciliation.md#1-money-representation) specifies an `amount_minor` signed-integer representation | `public.payments` has no minor-unit column; `merchant_amount`, `pinetree_fee`, and `gross_amount` are major-unit `NUMERIC` (exact decimal, not floating point). Conversion to minor units happens exactly once in `create_shift4_payment_attempt`, which rejects fractional minor units | **Documented / partially mitigated** — the balanced journal is the standard-compliant path; `payments` is an intent record, not the ledger |

D-2 and D-3 are reported, not fixed. Changing either alters payment,
presentation, or accounting behavior and is out of scope for governance
plumbing. D-4 is recorded for visibility; the boundary is already explicit in
`database/migrations/20260731163100_create_shift4_payment_attempts.sql` and is
consistent with Standard 03's rule that the payments table is not the ledger.

## Amending a standard

Per [Standard 06 §6](./06-roadmap-documentation-governance.md#6-change-control):
every standard carries a version, effective date, authority, superseded
documents, and normative cross-references. A material architecture change
creates an ADR and updates every affected standard before or with the
implementation.

Do not edit normative text in these files to reflect what the code happens to
do today. That is the exact failure mode the disagreement rule prohibits.

## Provenance

These files were imported from the six `.docx` source documents in the PineTree
architecture pack. Conversion normalized formatting only — metadata tables gained
a header row, callout boxes became blockquotes, and paragraph-per-rule sections
became bullet lists with their text preserved verbatim. No normative sentence was
added, removed, reworded, or weakened.
