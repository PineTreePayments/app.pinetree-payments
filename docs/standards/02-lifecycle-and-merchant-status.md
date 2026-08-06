**PINETREE PAYMENTS**

# Lifecycle and Merchant Status Standard

Canonical state machines and merchant-facing projections

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Effective | July 25, 2026 |
| Authority | PineTree architecture source of truth |

*Imported verbatim from `02_PineTree_Lifecycle_and_Merchant_Status_Standard.docx`. Formatting was normalized for Markdown; no normative text was altered. See [Standards README](./README.md).*

> **CORE RULE** — Canonical internal state, merchant-facing display status, and post-payment financial activity are separate concepts.

# 1. Lifecycle domains

| Domain | Record | What it answers |
| --- | --- | --- |
| Payment | payments | Did the customer payment attempt complete? |
| Withdrawal | withdrawals | Did funds leave the merchant-controlled provider balance? |
| Refund | refunds | Were funds returned after a confirmed payment? |
| Dispute | disputes | Is a card payment under claim, and what was the outcome? |
| Settlement | settlements / settlement_events | Did the provider settle funds and fees? |
| Merchant eligibility | merchant status and capability records | May this merchant use a PineTree capability? |

# 2. Payment state machine

| State | Definition | Allowed next states |
| --- | --- | --- |
| CREATED | Intent exists; customer payment request is not yet active. | PENDING, CANCELED |
| PENDING | Customer action is awaited; no qualifying payment activity detected. | PROCESSING, EXPIRED, CANCELED, INCOMPLETE |
| PROCESSING | A provider authorization, transaction hash, or qualifying network activity is verified and finality is pending. | CONFIRMED, FAILED |
| CONFIRMED | The payment met the rail-specific confirmation rule. | Terminal for payment lifecycle |
| FAILED | A verified provider/network rejection or terminal failure occurred. | Terminal; retry creates a new attempt |
| EXPIRED | The request exceeded its valid payment window without qualifying success. | Terminal |
| CANCELED | An authorized actor intentionally canceled before confirmation. | Terminal |
| INCOMPLETE | Session ended without qualifying payment activity under a defined abandonment rule. | Terminal |

- Wallet connection, ERC-20 approval, wallet launch, browser return, and client-side signing success are not payment confirmation.
- A Base USDC approval transaction is not the payment transaction and must never be stored as the successful payment hash.
- CONFIRMED means the payment confirmation rule passed; it does not mean provider settlement completed.
- Late success after a local terminal state requires a reconciliation exception workflow; it is never silently discarded.

# 3. Merchant payment projection

| Internal state | Merchant label | Color | Interaction |
| --- | --- | --- | --- |
| CREATED / PENDING | Waiting | Blue | Clock; customer action may be required |
| PROCESSING | Processing | Darker blue | Spinner/active progress |
| CONFIRMED | Confirmed | Green | Success |
| FAILED | Failed | Red | Terminal failure |
| EXPIRED | Expired | Muted red | Terminal timeout |
| CANCELED | Canceled | Gray | Intentional stop |
| INCOMPLETE | Incomplete | Amber | Ended without payment |
| Unmapped | Unknown | Neutral gray | Diagnostic fallback and alert |

# 4. Withdrawal state machine

| State | Merchant label | Meaning |
| --- | --- | --- |
| CREATED | Review withdrawal | Draft exists; not yet authorized |
| AUTHORIZATION_REQUIRED | Authorization required | Wallet/provider approval is visible and actionable |
| SUBMITTING | Submitting | Request is being transmitted; duplicate submission is blocked |
| SUBMITTED | Submitted | Provider accepted request and returned an authoritative reference |
| PROCESSING | Processing | Provider/network is executing the withdrawal |
| CONFIRMED | Confirmed | Provider/network confirmation rule passed |
| FAILED | Failed | Verified terminal failure; safe retry policy is displayed |
| CANCELED | Canceled | User intentionally stopped before provider acceptance |
| UNKNOWN | Checking status | Submission outcome cannot yet be proven; reconcile before retry |

> **MOBILE REQUIREMENT** — The authorization control and terminal outcome must occupy the top interaction layer. Confirmation cards, loading overlays, and floating panels may not obscure the authorization button or continue displaying Processing after canonical SUBMITTED/CONFIRMED is known.

# 5. Refund, dispute, and settlement states

| Lifecycle | Canonical states |
| --- | --- |
| Refund | REQUESTED -> PROCESSING -> SUCCEEDED \| FAILED \| CANCELED; supports partial and full amounts |
| Dispute | OPEN -> UNDER_REVIEW -> WON \| LOST \| WITHDRAWN; dispute amount remains separate from payment amount |
| Settlement | PENDING -> IN_TRANSIT -> SETTLED \| FAILED \| REVERSED |

A confirmed payment remains CONFIRMED even after a refund or dispute. Merchant transaction views may show secondary badges such as Partially refunded, Refunded, or Disputed, derived from their own records.

# 6. Transition enforcement

- The Engine checks the current state, event identity, allowed transition, and terminal-state rules in one database transaction.
- Duplicate events are acknowledged but cause no duplicate transition, ledger posting, notification, or outbound webhook.
- Out-of-order events are retained and either applied safely, marked superseded, or sent to exception review.
- Every transition stores occurred_at, received_at, source, normalized event type, provider reference, and correlation identifiers.

# Document governance

## Supersedes

- PineTree Transaction State Specification
- PineTree Merchant Status Architecture Standard
- Any shared payment/withdrawal/refund status enum that collapses independent lifecycles

## Normative cross-references

- [Platform Architecture Standard](./01-platform-architecture.md)
- [Financial Ledger, Money, and Reconciliation Standard](./03-financial-ledger-money-reconciliation.md)
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
