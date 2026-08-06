**PINETREE PAYMENTS**

# Provider Connector and Event Processing Standard

Adapter contracts, connector maturity, webhooks, idempotency, and reconciliation

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Effective | July 25, 2026 |
| Authority | PineTree architecture source of truth |

*Imported verbatim from `05_PineTree_Provider_Connector_and_Event_Processing_Standard.docx`. Formatting was normalized for Markdown; no normative text was altered. See [Standards README](./README.md).*

> **BOUNDARY** — Provider adapters translate external systems. PineTree Engine decides canonical state, fee posting, merchant presentation, and recovery behavior.

# 1. Universal connector contract

| Capability | Contract |
| --- | --- |
| connectMerchant | Start/complete provider connection without exposing secrets |
| getMerchantStatus | Return normalized connection, eligibility, and capability state |
| createPayment | Create or prepare an external attempt using PineTree idempotency/correlation IDs |
| getPaymentStatus | Fetch authoritative provider/network evidence |
| cancelPayment | Request cancellation only where provider semantics permit |
| createWithdrawal | Submit withdrawal and return authoritative provider reference/outcome |
| getWithdrawalStatus | Resolve submitted/unknown withdrawal state |
| verifyWebhook | Validate signature, timestamp, replay window, and raw body |
| translateEvent | Map provider event to a versioned normalized event |
| syncAccount | Refresh capabilities, balances, devices, or settlement data |
| reconcile | Enumerate authoritative records for a bounded time/cursor window |

# 2. Connector maturity levels

| Level | Name | Definition |
| --- | --- | --- |
| 1 | Listed | Provider appears in PineTree catalog |
| 2 | Request support | Merchant can register interest |
| 3 | Account connection | Merchant can authenticate/connect |
| 4 | Data synchronization | PineTree imports account, capability, balance, or transaction data |
| 5 | Payment creation | PineTree can initiate supported payment operations |
| 6 | Full event integration | Verified events, recovery, idempotency, and reconciliation are production-ready |
| 7 | Terminal control | PineTree can manage supported reader/device operations |

Merchant-facing provider states use Connected, Enabled, Disabled, Action required, Coming soon, or Requested as appropriate. The generic label Available is not used as a substitute for connection or enablement state.

# 3. Normalized event envelope

| Field | Requirement |
| --- | --- |
| event_id | PineTree UUID |
| provider_event_id | Provider's stable ID; required where supplied |
| provider_connection_id | Merchant-scoped connection identity |
| domain | payment, refund, withdrawal, dispute, settlement, merchant, device |
| type | Versioned PineTree normalized event type |
| resource_id / provider_reference | Canonical and external correlation |
| occurred_at / received_at | Provider occurrence and PineTree receipt timestamps |
| payload_version | Normalized schema version |
| raw_event_id | Link to immutable inbox payload |
| evidence | Amount, asset, network, transaction hash, receipt/status, confirmations as applicable |

# 4. Webhook inbox processing

- Receive the raw body and provider/connection context.
- Verify signature and replay/timestamp policy before trusting parsed content.
- Insert the raw event under a deduplication constraint.
- Translate it into the normalized envelope without mutating canonical state.
- Invoke Engine processing in a transaction that enforces allowed transitions and posting idempotency.
- Record processed, ignored, superseded, retryable, or dead-letter outcome with reason.
- Dispatch outbound webhooks/read-model updates from a transactional outbox.

# 5. Exactly-once effect

- Transport is assumed at-least-once; business effects are exactly-once through uniqueness constraints and transactional processing.
- Retries reuse the same provider and PineTree idempotency keys.
- Out-of-order events are retained. Older events cannot regress a terminal state.
- Unknown provider responses trigger lookup/reconciliation, not blind resubmission.
- A successful Base transaction requires a status-success receipt and expected transfer evidence; a reverted final contract call is FAILED even if an earlier approval succeeded.

# 6. Rail-specific confirmation evidence

| Rail | Minimum evidence |
| --- | --- |
| Bitcoin Lightning / Speed | Provider-confirmed payment/withdrawal reference, correct account/workspace, amount and status |
| Base ETH | Correct chain, successful receipt, expected payment/split value flow, canonical hash |
| Base USDC | Approval distinguished from payment call; successful payment receipt and expected Transfer logs/split |
| Solana SOL/USDC | Confirmed/finalized signature, expected recipient/mint/amount and no execution error |
| Stripe/Shift4/FluidPay cards | Provider object in accepted/succeeded state under correct connected merchant/account |
| Terminal | Provider reader/payment result correlated to PineTree attempt; client UI alone is insufficient |

# 7. Provider isolation and test contract

- Each adapter has contract tests for authentication, create, lookup, webhook verification, translation, duplicate delivery, out-of-order delivery, timeout, and reconciliation.
- Sandbox fixtures redact secrets and preserve realistic provider identifiers/statuses.
- Changes to one rail do not alter another rail's adapter or UI path without a documented shared-boundary reason.
- Provider SDK objects do not cross the adapter boundary; normalized types do.
- Feature flags and merchant capability checks prevent incomplete maturity levels from being presented as production-ready.

# Document governance

## Supersedes

- PineTree Provider Integration Specification
- PineTree Provider Connector Architecture & Merchant Adoption Strategy
- Legacy Coinbase Commerce connector references
- Legacy provider marketplace terminology that uses Available ambiguously

## Normative cross-references

- [Platform Architecture Standard](./01-platform-architecture.md)
- [Lifecycle and Merchant Status Standard](./02-lifecycle-and-merchant-status.md)
- [Financial Ledger, Money, and Reconciliation Standard](./03-financial-ledger-money-reconciliation.md)
- [Database, Identity, and Security Standard](./04-database-identity-security.md)

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
