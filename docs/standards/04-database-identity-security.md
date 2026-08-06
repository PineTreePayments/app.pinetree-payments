**PINETREE PAYMENTS**

# Database, Identity, and Security Standard

Canonical data domains, tenancy, RLS, credentials, and audit controls

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Effective | July 25, 2026 |
| Authority | PineTree architecture source of truth |

*Imported verbatim from `04_PineTree_Database_Identity_and_Security_Standard.docx`. Formatting was normalized for Markdown; no normative text was altered. See [Standards README](./README.md).*

> **TENANCY RULE** — An authenticated user is not inherently a merchant. Access is granted through explicit merchant membership, roles, locations, and scoped capabilities.

# 1. Canonical data domains

| Domain | Core records |
| --- | --- |
| Identity and tenancy | users/profiles, merchants, merchant_memberships, roles, locations |
| Merchant configuration | merchant_settings, capability/eligibility records |
| Provider connections | merchant_providers, provider_accounts, encrypted credential references, sync state |
| Payments | payments, payment_attempts, payment_events, idempotency records |
| Financial operations | refunds, disputes, withdrawals, settlements |
| Accounting | ledger_accounts, ledger_transactions, ledger_entries, ledger_links |
| Wallets | merchant_wallets, wallet/provider balance snapshots |
| Commerce and devices | checkout_links, inventory connectors, terminal locations/readers |
| Delivery and recovery | webhook_inbox, webhook_deliveries, outbox, reconciliation_runs/exceptions |
| Security and audit | api_keys, audit_log, privileged_action records |

# 2. Data authority and mutability

| Record type | Mutation policy |
| --- | --- |
| Payment/refund/withdrawal status | Engine-controlled transition with optimistic version or row lock |
| Raw provider events | Immutable after verified ingestion; processing metadata may advance |
| Ledger entries | Immutable; corrections use new reversing/correcting entries |
| Checkout links | Archived rather than hard deleted |
| Balance snapshots | Append or replace cache under source/observed_at policy; not accounting truth |
| Audit log | Append-only and access-restricted |

# 3. Required keys and constraints

- Every tenant-owned row carries merchant_id unless ownership is derived through an immutable parent and RLS can enforce it safely.
- Provider event identity is unique by provider connection plus provider event ID.
- Provider payment/reference keys are unique within the relevant provider account and operation type.
- Idempotency keys are unique by merchant, endpoint/operation, and retention window; stored request fingerprints reject conflicting reuse.
- Ledger posting keys and outbound webhook delivery attempt identities are unique.
- Lifecycle status uses controlled enums/check constraints and a version column.
- Timestamps use timestamptz; reports also use merchant_settings.timezone for merchant-local boundaries.

# 4. Row-level security and authorization

- Resolve the authenticated principal.
- Resolve active merchant membership and role.
- Apply location and capability scope where required.
- Authorize the operation server-side; never trust a client-provided merchant_id.
- Use service-role access only in controlled backend paths with explicit tenant filters.
- Audit privileged admin access and sensitive mutations.

The prior shortcut merchant_id = auth.uid() is prohibited unless a narrowly documented one-to-one model is deliberately retained for a specific table. The platform model must support multiple users, staff roles, locations, and exclusive PineTree administrator access.

# 5. API keys and secrets

| Data | Storage rule |
| --- | --- |
| PineTree API key | Show secret once; store prefix and cryptographic hash only |
| API scopes | Explicit operation and environment scopes |
| Key lifecycle | created_at, expires_at, revoked_at, last_used_at, rotation metadata |
| Provider OAuth tokens/secrets | Encrypted secret store/reference; never returned to UI or logged |
| Webhook secrets | Encrypted and versioned for rotation overlap |
| Wallet/private keys | PineTree must not store unless a separately approved custody architecture requires it |

# 6. Indexing and query standards

- Merchant transaction queries index merchant_id with created_at and common network/provider dimensions.
- Lifecycle work queues index nonterminal status plus next_check_at.
- Event inbox indexes processing_state, received_at, and provider connection.
- Webhook deliveries index destination, status, and next_attempt_at.
- Ledger queries index account, asset/currency, business date, and linked lifecycle record.
- Indexes are validated against actual query plans and removed when redundant.

# 7. Security and operational controls

- Validate webhook signatures against raw request bytes before parsing or normalization.
- Redact secrets, authorization headers, wallet connection tokens, and sensitive payload fields from logs.
- Use least privilege between public, authenticated, service, and administrative database roles.
- Database migrations are reviewed, reversible where feasible, and include backfill/constraint sequencing.
- Backups and recovery procedures are tested; destructive data changes require explicit scope and audit evidence.

# Document governance

## Supersedes

- PineTree Database Schema Specification
- Any plaintext API key design
- Any general RLS rule equating merchant_id directly to auth.uid()
- Any statement that calls payments the ledger

## Normative cross-references

- [Platform Architecture Standard](./01-platform-architecture.md)
- [Lifecycle and Merchant Status Standard](./02-lifecycle-and-merchant-status.md)
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
