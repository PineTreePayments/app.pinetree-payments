**PINETREE PAYMENTS**

# Platform Architecture Standard

Canonical system boundaries, authority, invariants, and operating model

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Effective | July 25, 2026 |
| Authority | PineTree architecture source of truth |

*Imported verbatim from `01_PineTree_Platform_Architecture_Standard.docx`. Formatting was normalized for Markdown; no normative text was altered. See [Standards README](./README.md).*

> **DECISION** — PineTree is a payment orchestration and merchant-experience layer. It does not become the processor, custodian, settlement provider, or system of record for a provider's external balance merely by integrating that provider.

# 1. Purpose and scope

This is the master architecture standard for PineTree POS, hosted checkout, Dashboard, PineTree Engine, API v1, provider connectors, webhooks, wallets, withdrawals, reporting, and administrative operations. Supporting standards define detailed state, accounting, data, security, and connector contracts.

# 2. Canonical architecture

| Layer | Owns | Must not own |
| --- | --- | --- |
| Interface | POS, checkout, dashboard, receipts, merchant presentation | Provider secrets, finality decisions, fee posting, canonical transitions |
| API | Authentication, validation, request envelopes, idempotency entry point | Provider-specific business logic or independent state machines |
| PineTree Engine | Routing, fee policy, canonical transitions, event processing, financial posting orchestration | UI state or provider SDK leakage |
| Provider adapters | External authentication, request translation, signatures, event normalization | Merchant presentation or canonical transition authority |
| Data platform | Durable intent, event inbox, ledger, read models, audit history | Inventing provider outcomes without verified evidence |
| External rails | Authorization, network execution, custody or settlement according to provider contract | PineTree's merchant-facing canonical contract |

# 3. Non-negotiable invariants

- All payment paths use Interface -> API -> Engine -> Provider Adapter -> External Rail; database writes occur through controlled service boundaries.
- The UI never marks a payment, refund, withdrawal, dispute, or settlement successful based only on wallet connection, wallet return, browser focus, or a submitted client action.
- Supabase/PostgreSQL is PineTree's canonical operational source of truth; external provider truth is imported through verified events and reconciliation.
- The payments table is a payment-intent and status record, not the accounting ledger.
- Financial entries are append-only and idempotent. Duplicate events cannot duplicate platform fees or merchant balances.
- The standard Platform Fee is $0.15 per transaction unless an explicit, versioned merchant pricing agreement applies.
- Payment confirmation, provider settlement, refunds, disputes, and withdrawals are separate lifecycles.
- Amounts use integer minor/base units with explicit currency, asset, network, denomination, and precision.
- Provider-specific terms are normalized before they reach merchant-facing surfaces.
- Merchant eligibility is distinct from payment, connector, wallet, and withdrawal status.

# 4. Product surfaces

| Surface | Primary responsibility | Canonical dependency |
| --- | --- | --- |
| POS | Native card, cash, Bitcoin, Base, and Solana payment initiation and status display | Engine payment contract |
| Hosted checkout | Customer payment selection, wallet launch, and safe return state | Engine payment contract |
| Dashboard | Operations, transactions, providers, wallet, reporting, settings | Database read models |
| PineTree API v1 | External creation, retrieval, cancellation, and webhook delivery | Versioned Engine services |
| Admin | Role-restricted platform support and diagnostics | Audited privileged services |

# 5. Current rail and provider map

| Capability | Current provider/rail | PineTree role |
| --- | --- | --- |
| Bitcoin Lightning | Speed Custom Connect | Unified merchant UI; Speed custody/balance; Instant Send where eligible |
| Base ETH / USDC | Base Pay with WalletConnect and payment split contract flow | Payment orchestration, fee split verification, network confirmation |
| Solana SOL / USDC | Solana Pay and supported wallets | Payment URI/wallet orchestration and confirmation |
| Cards | Stripe Connect + Terminal; Shift4; FluidPay path | Native POS and provider connection experience |
| Shift4 crypto | Shift4 integration | Connector and merchant-facing status normalization |
| Commerce | Hosted checkout, payment links, Shopify/WooCommerce connectors | Unified checkout and event/reporting layer |

# 6. Engine responsibilities

- Validate the merchant, location, provider connection, rail, amount, and request idempotency key.
- Create the canonical intent and calculate the versioned $0.15 Platform Fee.
- Route to an enabled connector and persist the provider reference without exposing secrets.
- Accept verified normalized events from webhooks, watchers, polling, or reconciliation.
- Enforce allowed transitions transactionally.
- Write the event history, update the operational record, and post financial entries exactly once in effect.
- Publish read-model and outbound-webhook updates after the transaction commits.

# 7. Failure and recovery model

- Provider timeout is an unknown outcome until the provider or network is checked; it is not automatically a failed payment.
- Webhook delivery is at-least-once. Processing must therefore be idempotent and order-aware.
- The one-minute Supabase scheduled stale-payment sweep is a recovery mechanism, not the primary confirmation path.
- Reconciliation compares PineTree records against provider/network evidence and creates auditable corrections rather than rewriting history.
- Mobile presentation overlays cannot obscure the authorization control or canonical completion state.

# 8. Authority matrix

| Decision | Authority |
| --- | --- |
| Payment transition | PineTree Engine state machine |
| Provider event authenticity | Provider adapter verification |
| Merchant display status | Presentation projection from canonical lifecycle |
| Financial balance impact | Append-only ledger posting rules |
| Settlement fact | Settlement lifecycle plus provider reconciliation |
| Merchant access | Membership/role policy and audited authorization |
| Provider enablement | Merchant-provider connection and eligibility records |

# Document governance

## Supersedes

- PineTree Platform Architecture Document
- PineTree Repository Structure & Backend Architecture (architecture portions)
- Conflicting architecture statements in earlier project documents

## Normative cross-references

- [Lifecycle and Merchant Status Standard](./02-lifecycle-and-merchant-status.md)
- [Financial Ledger, Money, and Reconciliation Standard](./03-financial-ledger-money-reconciliation.md)
- [Database, Identity, and Security Standard](./04-database-identity-security.md)
- [Provider Connector and Event Processing Standard](./05-provider-connectors-events.md)
- [Technical Roadmap and Documentation Governance](./06-roadmap-documentation-governance.md)

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
