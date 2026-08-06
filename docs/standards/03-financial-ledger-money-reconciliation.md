**PINETREE PAYMENTS**

# Financial Ledger, Money, and Reconciliation Standard

Append-only accounting, denomination safety, fee posting, and recovery controls

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Effective | July 25, 2026 |
| Authority | PineTree architecture source of truth |

*Imported verbatim from `03_PineTree_Financial_Ledger_Money_and_Reconciliation_Standard.docx`. Formatting was normalized for Markdown; no normative text was altered. See [Standards README](./README.md).*

> **ACCOUNTING RULE** — Operational records may change state. Financial history is append-only. The payments table is not the ledger.

# 1. Money representation

| Field | Requirement |
| --- | --- |
| amount_minor | Signed integer in the currency/asset's declared minor or base unit |
| currency_or_asset | ISO currency or controlled asset code, e.g., USD, BTC, ETH, SOL, USDC |
| network | Controlled network identifier where applicable, e.g., lightning, base, solana |
| unit | Explicit denomination, e.g., cents, sats, wei, lamports, USDC base units |
| precision | Declared decimal precision used for display/conversion |
| fx_rate | Rate as rational/decimal plus source, quote currency, and observed_at |
| pricing_version | Versioned fee/pricing policy used at intent creation |

- Floating-point values MUST NOT be authoritative for money.
- BTC provider balances denominated in sats are stored and reconciled as sats, even when a provider serializes a decimal value.
- Conversions preserve source amount, destination amount, rate, timestamp, and rounding rule.
- The PineTree Platform Fee is $0.15 per transaction under the default pricing version.

# 2. Ledger model

Use an append-only journal with balanced postings. A journal transaction is created once for a normalized financial event and contains two or more entries whose debits and credits balance by currency/asset.

| Entity | Purpose | Key controls |
| --- | --- | --- |
| ledger_accounts | Named merchant, PineTree fee, provider fee, clearing, wallet, and adjustment accounts | Unique owner/type/currency/network |
| ledger_transactions | One economic event or correction | Unique posting key; immutable business date/source |
| ledger_entries | Debit/credit lines | Integer amount; balanced within transaction |
| ledger_links | Links journal to payment/refund/withdrawal/settlement/event | No orphan financial posting |

# 3. Posting examples

| Event | Illustrative posting |
| --- | --- |
| Confirmed customer payment | Debit provider/wallet clearing; credit merchant receivable and PineTree fee receivable |
| Provider/network fee | Debit fee expense or merchant fee allocation; credit provider clearing |
| Merchant withdrawal | Debit merchant payable/balance; credit provider/wallet clearing |
| Refund | Debit merchant/refund obligation; credit clearing/cash account |
| Correction | New reversing and corrected entries; never edit the original journal |

# 4. Idempotent fee and ledger posting

- Construct a deterministic posting key from lifecycle domain, record ID, normalized event type, and posting version.
- Open a database transaction and lock or compare the current lifecycle version.
- Insert the posting under a uniqueness constraint.
- Write balanced entries and lifecycle link records.
- Commit the lifecycle transition and journal atomically.
- Publish downstream notifications through an outbox after commit.

# 5. Balance model

- Displayed balances are derived read models or provider snapshots; they are not independently editable financial truth.
- Provider-custodied balances, such as Speed Bitcoin balances, are labeled by custody/source and reconciled to provider evidence.
- Available, pending, held, and withdrawable balances are separate values with explicit calculation rules.
- A cached wallet balance records observed_at and source; stale snapshots cannot be presented as current without disclosure.

# 6. Reconciliation

| Level | Comparison | Response |
| --- | --- | --- |
| Event | Raw provider event vs. normalized event and lifecycle transition | Replay idempotently or open exception |
| Payment | Provider/network status and amount vs. PineTree payment | Correct through auditable transition/correction |
| Ledger | Journal-derived balance vs. provider balance/settlement report | Classify timing, fee, denomination, missing, duplicate |
| Settlement | Provider payout/settlement lines vs. PineTree clearing accounts | Post settlement or variance adjustment |

- Reconciliation jobs are safe to repeat and store run ID, scope, cursor, counts, differences, and resolution.
- A provider timeout after successful signing/submission is UNKNOWN until a lookup resolves it; users are protected from duplicate withdrawal/payment attempts.
- The stale-payment sweep may discover missing confirmation, but confirmation still requires provider/network evidence.
- Material variances create alerts and remain open until resolved with an actor, reason, and evidence.

# 7. Audit and retention

- Retain raw provider payloads subject to privacy/security policy, normalized events, state changes, posting keys, and correction links.
- Record both provider occurred_at and PineTree received_at timestamps.
- Privileged adjustments require reason codes and actor identity.
- Reports specify timezone, currency/asset, inclusion state, and whether values are payment, settlement, or ledger based.

# Document governance

## Supersedes

- Statements describing payments as the primary ledger
- Generic numeric-only money definitions in the earlier database specification
- Any mutable balance update used as the sole accounting record

## Normative cross-references

- [Platform Architecture Standard](./01-platform-architecture.md)
- [Lifecycle and Merchant Status Standard](./02-lifecycle-and-merchant-status.md)
- [Database, Identity, and Security Standard](./04-database-identity-security.md)
- [Provider Connector and Event Processing Standard](./05-provider-connectors-events.md)

## Interpretation rules

- MUST and MUST NOT define mandatory production behavior.
- SHOULD defines the default unless a documented architecture decision record approves an exception.
- Provider-specific behavior never overrides a PineTree canonical contract.
- If code and this standard disagree, the disagreement must be logged and deliberately resolved; neither is silently treated as correct.

# Source register

This standard was consolidated from the following PineTree project documents and the current platform decisions recorded through July 25, 2026.

- PineTree Transaction State Specification
- PineTree Repository Structure & Backend Architecture
- PineTree Database Schema Specification
- PineTree Technical Roadmap
- PineTree Platform Architecture Document
- PineTree Website Structure (Stripe-Style Layout)
- PineTree Provider Integration Specification
- PineTree Floating Window Master Template
- PineTree Payments - ChatGPT Project Prompt Guardrails & Skill Reference
- PineTree Provider Connector Architecture & Merchant Adoption Strategy
- PineTree Merchant Status Architecture Standard
