**PINETREE PAYMENTS**

# Technical Roadmap and Documentation Governance

Architecture-aligned delivery sequence, acceptance gates, and source-of-truth controls

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Effective | July 25, 2026 |
| Authority | PineTree architecture source of truth |

*Imported verbatim from `06_PineTree_Technical_Roadmap_and_Documentation_Governance.docx`. Formatting was normalized for Markdown; no normative text was altered. See [Standards README](./README.md).*

> **CURRENT POSITION** — PineTree has progressed beyond the legacy crypto-only roadmap. Delivery now centers on hardening hosted checkout and POS rails, formalizing financial controls, completing provider connections, and exposing a stable Engine/API contract.

# 1. Delivery principles

- Prioritize hosted online checkout, then native POS card flow, then Engine/API v1, then broader terminal coverage.
- Treat completed prototypes as unverified until lifecycle, idempotency, reconciliation, security, and reporting acceptance gates pass.
- Preserve the merchant's existing providers and hardware where practical; PineTree is the unified operating layer.
- Ship provider capabilities by maturity level rather than representing every listed provider as fully integrated.
- Keep the $0.15 Platform Fee versioned and validated across all supported payment rails.

# 2. Phased roadmap

| Phase | Outcome | Exit gate |
| --- | --- | --- |
| A. Architecture baseline | Adopt this six-document standard pack and resolve code/spec conflicts | Owners and ADRs assigned; legacy docs marked superseded |
| B. Payment/withdrawal hardening | Correct mobile and desktop lifecycles, overlays, unknown outcomes, and canonical hashes | One successful and failure-path test per rail; no false Processing/Completed |
| C. Financial control plane | Append-only ledger, denomination rules, idempotent $0.15 posting, reconciliation exceptions | Balance replay matches provider evidence; duplicates do not double-post |
| D. Hosted checkout | Production-grade checkout links, cancel/expire, wallet return, webhook delivery | Cross-device and recovery test suite passes |
| E. Native POS cards | Stripe Terminal/manual entry and supported Shift4/FluidPay paths without unintended hosted fallback | Reader, no-reader, decline, retry, disconnect, and connected-account tests pass |
| F. Engine/API v1 | Versioned payment API, connector contract, webhooks, SDK documentation | Contract tests, scopes, rate limits, idempotency, and delivery retry pass |
| G. Reporting/operations | Merchant-local reporting, settlement distinction, support diagnostics, audit controls | Totals reconcile by rail/provider/timezone |
| H. Connector and commerce expansion | Shift4, FluidPay, inventory and commerce connectors mature incrementally | Each capability published at verified maturity level |

# 3. Immediate acceptance priorities

- Run one payment on every supported asset/rail and retain browser/mobile console output, Vercel logs, provider evidence, canonical payment row, event row, and ledger result.
- Validate Bitcoin Lightning payment, split fee, balance, and non-Lightning-address withdrawal reporting.
- Validate Base ETH and USDC canonical payment hashes, status-success receipts, and expected transfers; never store approval hashes as payments.
- Validate Solana SOL and USDC wallet selection, deep-link return, signature finality, and amount/mint/recipient.
- Validate mobile withdrawal authorization visibility and transition through Submitted/Confirmed without stale Processing overlays.
- Validate Stripe Terminal connected-account context, reader/no-reader states, manual-entry behavior, and explicit fallback only.

# 4. Standard definition of done

| Gate | Required evidence |
| --- | --- |
| Architecture | Change stays within Interface -> API -> Engine -> Adapter -> data boundaries |
| Lifecycle | Allowed transitions and merchant projection verified |
| Idempotency | Duplicate request/event causes no duplicate provider operation or financial effect |
| Financial | Integer denomination, $0.15 pricing version, balanced posting, and reconciliation check |
| Security | Tenant authorization, secret handling, webhook verification, and audit coverage |
| Recovery | Timeout, retry, stale state, missed webhook, and out-of-order event behavior |
| UI | Desktop/mobile, overlay ordering, loading, terminal state, accessibility |
| Operations | Logs/correlation IDs sufficient without exposing secrets |
| Documentation | Affected standard/API/ADR/test checklist updated in the same change |

# 5. Documentation hierarchy

| Level | Artifact | Role |
| --- | --- | --- |
| 1 | Platform Architecture Standard | System-wide authority and invariants |
| 2 | Domain standards in this pack | Lifecycle, ledger, data/security, providers/events |
| 3 | Architecture Decision Records | Approved deviations and irreversible/local decisions |
| 4 | API schemas, database migrations, provider contracts | Executable interface truth |
| 5 | Runbooks, test plans, UI templates, website structure | Operational and presentation guidance |
| 6 | Task prompts and agent guardrails | Surgical implementation instructions; never override levels 1-4 |

# 6. Change control

- Every standard has version, effective date, authority, superseded documents, and normative cross-references.
- A material architecture change creates an ADR and updates every affected standard before or with implementation.
- Provider lists, fee amounts, maturity, status terms, and roadmaps are reviewed for drift at each release milestone.
- Website and floating-card documents remain UI references and must not define payment finality, ledger, provider, or security behavior.
- ChatGPT/project prompt guardrails remain useful for surgical scope but are subordinate to this architecture pack and current repository evidence.

# 7. Retired assumptions

- PineTree is not crypto-only.
- Coinbase Commerce is not a current production provider.
- The Platform Fee is not $0.10; the current default is $0.15.
- Payments are not the accounting ledger.
- Refunded and Disputed are not replacements for canonical payment state.
- Provider Available is not equivalent to connected or enabled.
- auth.uid() is not universally equivalent to merchant_id.
- Webhook receipt alone does not guarantee exactly-once processing or settlement.

# Document governance

## Supersedes

- PineTree Technical Roadmap
- Outdated roadmap portions of the PineTree Platform Architecture Document
- Outdated provider/fee statements in the Website Structure reference

## Normative cross-references

- All five other documents in this architecture pack:
  - [Platform Architecture Standard](./01-platform-architecture.md)
  - [Lifecycle and Merchant Status Standard](./02-lifecycle-and-merchant-status.md)
  - [Financial Ledger, Money, and Reconciliation Standard](./03-financial-ledger-money-reconciliation.md)
  - [Database, Identity, and Security Standard](./04-database-identity-security.md)
  - [Provider Connector and Event Processing Standard](./05-provider-connectors-events.md)
- PineTree Website Structure and Floating Window Master Template as non-normative UI references
- PineTree ChatGPT Project Prompt Guardrails as subordinate implementation guidance

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
