# PineTree Documentation Index

Every document in `docs/`, classified. Read a document's class before treating it
as current. This index exists because the repository contains 80+ documents with
no previous ranking, several of which are superseded or self-contradictory but
read as though they were authoritative.

**Nothing is deleted or moved.** Classification is advisory metadata.

## Classes

| Class | Meaning | Trust |
|---|---|---|
| **Canonical** | Defines PineTree. Authority levels 1–2. | Binding |
| **Scoped active** | Correct and current for a bounded area. | Binding within scope |
| **Operational** | Runbooks, checklists, env setup. Level 5. | Follow when performing that operation |
| **Presentation reference** | Copy, wording, layout, examples. | Non-normative |
| **Historical** | Accurate point-in-time record. Not current state. | Do not act on |
| **Superseded** | Replaced. May contain statements now wrong. | Do not act on |
| **Pending review** | Unverified against the standards in this pass. | Verify before relying |

Authority order is in [`docs/standards/README.md`](./standards/README.md).

---

## Canonical

| Document | Notes |
|---|---|
| [`standards/README.md`](./standards/README.md) | Authority hierarchy + divergence register. Start here. |
| [`standards/01-platform-architecture.md`](./standards/01-platform-architecture.md) | Level 1. System-wide invariants. |
| [`standards/02-lifecycle-and-merchant-status.md`](./standards/02-lifecycle-and-merchant-status.md) | Level 2. State machines, merchant projection. |
| [`standards/03-financial-ledger-money-reconciliation.md`](./standards/03-financial-ledger-money-reconciliation.md) | Level 2. Append-only journal, integer money. |
| [`standards/04-database-identity-security.md`](./standards/04-database-identity-security.md) | Level 2. Tenancy, RLS, secrets, audit. |
| [`standards/05-provider-connectors-events.md`](./standards/05-provider-connectors-events.md) | Level 2. Adapter contract, exactly-once, rail evidence. |
| [`standards/06-roadmap-documentation-governance.md`](./standards/06-roadmap-documentation-governance.md) | Level 2. Definition of done, doc hierarchy, change control. |
| [`architecture.md`](./architecture.md) | Repository-level restatement of Standards 01–02, **subordinate** to them. Cited by 5 source files. Its `Background Jobs (AUTHORITATIVE)` section remains authoritative — no standard covers scheduler inventory. |
| [`architecture/adr-0001-ledger-journal-entries.md`](./architecture/adr-0001-ledger-journal-entries.md) | Level 3. Only accepted ADR. Test-enforced. Records a deliberate divergence from Standard 03. |
| [`api/openapi.yaml`](./api/openapi.yaml) | Level 4. Executable public contract. Test-enforced. |
| [`security/route-auth-matrix.md`](./security/route-auth-matrix.md) | Level 4. Route authentication truth. Test-enforced. |
| [`security/webhook-verification-fail-closed.md`](./security/webhook-verification-fail-closed.md) | Level 3 (security decision note). Records the retirement of the generic provider webhook route and the fail-closed verification contract. Closes audit findings F-1/F-2. |

## Scoped active

| Document | Scope |
|---|---|
| [`domains/solana-wallet-routing.md`](./domains/solana-wallet-routing.md) | Per-wallet Solana strategy registry as implemented. Replaces both legacy Solana skills. |
| [`api/provider-integration.md`](./api/provider-integration.md) | Partner-facing provider adapter guide. **Note the filename collision** with `provider-integrations.md` below. |
| [`api/payment-states.md`](./api/payment-states.md) | Engine/API/provider/merchant status separation. Test-enforced. |
| [`api/webhook-events.md`](./api/webhook-events.md) | Supported event catalog. Test-enforced. |
| [`api/webhooks.md`](./api/webhooks.md) | Webhook delivery + signature verification. |
| [`api/webhook-deliveries.md`](./api/webhook-deliveries.md) | Delivery monitoring and retry. |
| [`api/checkout-sessions.md`](./api/checkout-sessions.md) | Hosted checkout API. |
| [`api/rails-and-assets.md`](./api/rails-and-assets.md) | Supported rails/assets. Test-enforced. |
| [`api/idempotency.md`](./api/idempotency.md) | Idempotency contract. |
| [`api/authentication.md`](./api/authentication.md) | API auth. Test-enforced. |
| [`api/api-keys.md`](./api/api-keys.md) | Key lifecycle. |
| [`api/errors.md`](./api/errors.md) | Error taxonomy. |
| [`api/payments.md`](./api/payments.md) | Payment object. |
| [`api/transactions.md`](./api/transactions.md) | Transaction reads. Orphaned (no inbound links) but current. |
| [`api/receipts.md`](./api/receipts.md) | Receipts. Orphaned but current. |
| [`api/version-strategy.md`](./api/version-strategy.md) | API versioning policy. |
| [`api/payment-intents.md`](./api/payment-intents.md) | Internal hosted-checkout intent routes. Orphaned, but verified against `app/api/payment-intents/` — the documented routes exist. |
| [`api/node-sdk.md`](./api/node-sdk.md) | Published `@pinetreepayments/node`. |
| [`api/browser-sdk.md`](./api/browser-sdk.md) | Published `@pinetreepayments/js`. |
| [`api/react-sdk.md`](./api/react-sdk.md) | Published `@pinetreepayments/react`. |
| [`api/sdks.md`](./api/sdks.md) | SDK index. Test-enforced. |
| [`api/index.md`](./api/index.md) | API reference entry point. Test-enforced. **Overlaps** `api/overview.md`. |
| [`api/overview.md`](./api/overview.md) | API inventory. Test-enforced. **Overlaps** `api/index.md`. |
| [`api/quickstart.md`](./api/quickstart.md) | Integration quickstart. Test-enforced. |
| [`api/partner-api-summary.md`](./api/partner-api-summary.md) | Partner summary. |
| [`architecture/shift4-integration-architecture.md`](./architecture/shift4-integration-architecture.md) | Shift4 boundary. Test-enforced. |
| [`architecture/shift4-route-matrix.md`](./architecture/shift4-route-matrix.md) | Shift4 route inventory. Test-enforced. |
| [`architecture/shift4-reachability-inventory.md`](./architecture/shift4-reachability-inventory.md) | Shift4 reachability. Test-enforced. |
| [`onboarding/business-verification.md`](./onboarding/business-verification.md) | Merchant business verification. Currently uncommitted work in progress. |
| [`stripe-terminal-phase-2.md`](./stripe-terminal-phase-2.md) | Stripe Terminal. Orphaned and oddly placed at `docs/` root, but Terminal is live (`npm run smoke:stripe-terminal`). |
| [`providers/fluidpay-provider-contract-checklist.md`](./providers/fluidpay-provider-contract-checklist.md) | FluidPay adapter contract. Orphaned but current. |
| [`auth/supabase-email-templates.md`](./auth/supabase-email-templates.md) | Supabase auth email templates. Test-enforced. |

## Operational

| Document | Operation |
|---|---|
| [`environment/staging-setup.md`](./environment/staging-setup.md) | Staging bring-up. Test-enforced. |
| [`environment/bitcoin-fee-settlement.md`](./environment/bitcoin-fee-settlement.md) | BTC fee settlement. Test-enforced; cited by 4 source files. |
| [`environment/lightning-sweep-env-checklist.md`](./environment/lightning-sweep-env-checklist.md) | Lightning sweep env. |
| [`environment/speed-credentials-env-checklist.md`](./environment/speed-credentials-env-checklist.md) | Speed credentials. |
| [`environment/bridge-env-checklist.md`](./environment/bridge-env-checklist.md) | Stripe Bridge env. |
| [`environment/dynamic-external-jwt-setup.md`](./environment/dynamic-external-jwt-setup.md) | Dynamic external JWT. |
| [`environment/shopify-env-checklist.md`](./environment/shopify-env-checklist.md) | Shopify connector env. |
| [`environment/woocommerce-test-checklist.md`](./environment/woocommerce-test-checklist.md) | WooCommerce validation. Test-enforced. |
| [`environment/shift4-rest-env-checklist.md`](./environment/shift4-rest-env-checklist.md) | Shift4 REST env. |
| [`environment/shift4-feature-flags.md`](./environment/shift4-feature-flags.md) | Shift4 flags. Orphaned. |
| [`environment/shift4-onboarding.md`](./environment/shift4-onboarding.md) | Shift4 merchant onboarding. Orphaned. |
| [`environment/shift4-certification-runbook.md`](./environment/shift4-certification-runbook.md) | Shift4 certification. Orphaned. |
| [`environment/shift4-production-readiness-checklist.md`](./environment/shift4-production-readiness-checklist.md) | Shift4 go-live. Orphaned. |
| [`environment/shift4-staging-database-execution.md`](./environment/shift4-staging-database-execution.md) | Shift4 staging DB apply. Orphaned. |
| [`environment/shift4-phase-2-rollout.md`](./environment/shift4-phase-2-rollout.md) | Shift4 phase 2 rollout. |
| [`api/go-live-checklist.md`](./api/go-live-checklist.md) | Production go-live. |
| [`api/testing.md`](./api/testing.md) | Test-mode guidance. |
| [`api/npm-publish-checklist.md`](./api/npm-publish-checklist.md) | npm publication. |
| [`api/node-sdk-release-checklist.md`](./api/node-sdk-release-checklist.md) | SDK release. Orphaned. |
| [`api/node-sdk-integration-testing.md`](./api/node-sdk-integration-testing.md) | SDK integration tests. |
| [`api/react-sdk-integration-testing.md`](./api/react-sdk-integration-testing.md) | React SDK integration tests. |
| [`api/local-stack-release-validation.md`](./api/local-stack-release-validation.md) | Local release validation. |
| [`security/dependency-risk-register.md`](./security/dependency-risk-register.md) | Dependency risk. Orphaned. |

## Presentation reference

| Document | Notes |
|---|---|
| [`api/examples/node-create-session.md`](./api/examples/node-create-session.md) | Code sample. Orphaned. |
| [`api/examples/node-webhook-verification.md`](./api/examples/node-webhook-verification.md) | Code sample. Orphaned. |
| [`api/examples/rest-create-session.md`](./api/examples/rest-create-session.md) | Code sample. Orphaned. |
| [`api/examples/rest-webhook-verification.md`](./api/examples/rest-webhook-verification.md) | Code sample. Orphaned. |
| [`api/examples/session-lifecycle.md`](./api/examples/session-lifecycle.md) | Code sample. Orphaned. |
| `api/squarespace-api-docs.html` | Captured third-party page, layout reference only. |
| `api/squarespace-developer-page.html` | Captured third-party page, layout reference only. |

Per [Standard 06 §6](./standards/06-roadmap-documentation-governance.md#6-change-control),
presentation references "must not define payment finality, ledger, provider, or
security behavior."

## Historical

Accurate records of a moment. Do not act on them as current state.

| Document | Why historical |
|---|---|
| [`architecture/shift4-phase-2-implementation-report.md`](./architecture/shift4-phase-2-implementation-report.md) | Point-in-time implementation report. Orphaned. |
| [`architecture/shift4-retail-prehardware-readiness.md`](./architecture/shift4-retail-prehardware-readiness.md) | Pre-hardware readiness snapshot. Orphaned. |
| [`architecture/canonical-transaction-read-audit.md`](./architecture/canonical-transaction-read-audit.md) | Completed audit. Orphaned. |
| [`api/platform-readiness-report.md`](./api/platform-readiness-report.md) | Readiness snapshot. |

## Superseded

Retained, never routed. Excluded in
[`.ai/task-map.json`](../.ai/task-map.json).

| Document | Superseded by | Risk if followed |
|---|---|---|
| [`skills/api.md`](./skills/api.md) | [Standard 01 §2](./standards/01-platform-architecture.md#2-canonical-architecture) | Incomplete layer rules |
| [`skills/database.md`](./skills/database.md) | Standards [01](./standards/01-platform-architecture.md), [04](./standards/04-database-identity-security.md) | Missing most of the state machine |
| [`skills/engine.md`](./skills/engine.md) | [Standard 01 §6](./standards/01-platform-architecture.md#6-engine-responsibilities) | Incomplete Engine duties |
| [`skills/providers.md`](./skills/providers.md) | [Standard 05](./standards/05-provider-connectors-events.md) | Missing connector contract |
| [`skills/watcher.md`](./skills/watcher.md) | [Standard 05 §4–5](./standards/05-provider-connectors-events.md#4-webhook-inbox-processing) | Missing exactly-once rules |
| [`skills/webhook.md`](./skills/webhook.md) | [Standard 05 §4](./standards/05-provider-connectors-events.md#4-webhook-inbox-processing) | Missing raw-bytes verification |
| [`skills/solana-pay.md`](./skills/solana-pay.md) | [`domains/solana-wallet-routing.md`](./domains/solana-wallet-routing.md) | **Forbids live Phantom/Solflare paths** |
| [`skills/solana-wallet-signing.md`](./skills/solana-wallet-signing.md) | [`domains/solana-wallet-routing.md`](./domains/solana-wallet-routing.md) | **Forbids the live `solana:` URI path** |
| [`api/node-sdk-contract.md`](./api/node-sdk-contract.md) | [`api/node-sdk.md`](./api/node-sdk.md) | States the SDK "is not a published package"; it ships on npm and CI runs `release-candidate` |
| [`api/provider-integrations.md`](./api/provider-integrations.md) | [Standard 05](./standards/05-provider-connectors-events.md) + [`api/provider-integration.md`](./api/provider-integration.md) | 16-line internal webhook list whose **filename collides** with the 300-line partner standard |

See [`skills/README.md`](./skills/README.md) for the full legacy-skills rationale.

## Pending review

No documents currently in this class. Use it for a document added without being
verified against the standards, so the gap is visible rather than implied.

---

## Known documentation defects (recorded, not fixed)

Governance plumbing does not change application code or delete documents, so
these are logged here for a deliberate decision.

| # | Defect | Evidence |
|---|---|---|
| X-1 | Broken doc reference in source: `lib/email/sendWalletSecurityNotification.ts:40` cites `docs/environment/wallet-sweep-env-checklist.md`, which does not exist. Closest real file is `environment/lightning-sweep-env-checklist.md`. | Full-repo grep: one citation, zero matching files |
| X-2 | Filename collision: `api/provider-integration.md` (partner standard, 300 lines) vs `api/provider-integrations.md` (internal list, 16 lines). Singular/plural, unrelated content. | Both present |
| X-3 | Two competing API entry points, `api/index.md` and `api/overview.md`, both test-enforced, with no stated relationship. | Both present |
| X-4 | `api/node-sdk-contract.md` contradicts the shipped SDK. | See Superseded table |
| X-5 | Standard 02 §3 requires an `Unmapped → Unknown` merchant projection; `lib/utils/paymentStatus.ts` has no `Unknown` label and instead **throws** on an unmapped value. | Divergence **D-2** in [`standards/README.md`](./standards/README.md) |
| X-6 | `.claude/settings.local.json` is tracked in git despite the `.local` suffix, and contains machine-specific absolute Windows paths. | `git ls-files` |
| X-7 | `.env.example` is not validated by `npm run check:env` — `scripts/check-environment.mjs` reads `.env`/`.env.local` against a hardcoded list, so the example file can drift silently. | `scripts/check-environment.mjs` |
| X-8 | `README.md` is unmodified `create-next-app` boilerplate plus provider env notes; it never points to the architecture or standards. | `README.md` lines 1–37 |

## Maintaining this index

Add every new document here in the same change that creates it, per
[Standard 06 §4](./standards/06-roadmap-documentation-governance.md#4-standard-definition-of-done).
Move a document between classes rather than deleting it.
