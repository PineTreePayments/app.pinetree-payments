# PineTree Engineering Documentation

The complete map of engineering documentation. **If a document is not listed here
and not returned by the preflight, it is not engineering authority** — do not
implement from it.

## 1. Start here

| Document | Authority | Purpose | Read it when |
|---|---|---|---|
| [`../AGENTS.md`](../AGENTS.md) | Contract | Boundaries, invariants, scope rules for humans and agents | Before any engineering work |
| [`../CLAUDE.md`](../CLAUDE.md) | Pointer | Points Claude Code at `AGENTS.md` | Never directly — it only redirects |
| [`standards/README.md`](./standards/README.md) | Canonical | Authority order + the open divergence register | Before resolving any code/doc disagreement |
| [`../.ai/README.md`](../.ai/README.md) | Tooling | How task routing resolves documents | When adding or debugging a route |

Run the preflight before planning or editing:

```bash
npm run ai:preflight -- --task "<what you are doing>" --path <files you expect to touch>
```

## 2. Canonical standards

Authority levels 1–2. These define PineTree. All are Version 1.0, effective
2026-07-25.

| Document | Authority | Purpose | Read it when |
|---|---|---|---|
| [`standards/01-platform-architecture.md`](./standards/01-platform-architecture.md) | **Level 1** | System boundaries, non-negotiable invariants, authority matrix, Engine responsibilities | Always — every task |
| [`standards/02-lifecycle-and-merchant-status.md`](./standards/02-lifecycle-and-merchant-status.md) | Level 2 | Payment/withdrawal/refund/dispute/settlement state machines and merchant projection | Touching status, transitions, or labels |
| [`standards/03-financial-ledger-money-reconciliation.md`](./standards/03-financial-ledger-money-reconciliation.md) | Level 2 | Append-only journal, integer money, idempotent fee posting, reconciliation | Touching money, fees, balances, or the ledger |
| [`standards/04-database-identity-security.md`](./standards/04-database-identity-security.md) | Level 2 | Data domains, tenancy, RLS, keys and secrets, indexing, audit | Touching schema, tenancy, auth, or secrets |
| [`standards/05-provider-connectors-events.md`](./standards/05-provider-connectors-events.md) | Level 2 | Adapter contract, maturity levels, normalized events, exactly-once effect, rail evidence | Touching a provider, webhook, or event |
| [`standards/06-roadmap-documentation-governance.md`](./standards/06-roadmap-documentation-governance.md) | Level 2 | Delivery sequence, definition of done, documentation hierarchy, change control | Planning work or deciding when it is finished |

## 3. Architecture and ADRs

| Document | Authority | Purpose | Read it when |
|---|---|---|---|
| [`architecture.md`](./architecture.md) | Canonical (subordinate to Standards 01–02) | Repository-level restatement of the layering, state machine, and fee rules. Its `Background Jobs (AUTHORITATIVE)` section is the only source for scheduler inventory. Cited by five source files. | Working in `engine/`, or on any scheduled job |
| [`architecture/adr-0001-ledger-journal-entries.md`](./architecture/adr-0001-ledger-journal-entries.md) | **Accepted ADR** (level 3) | Balanced journal design, deterministic posting keys, the deliberate `ledger_journal_entries` naming divergence from Standard 03 | Touching ledger schema or posting |
| [`architecture/adr-0002-canonical-transaction-reads.md`](./architecture/adr-0002-canonical-transaction-reads.md) | **Accepted ADR** (level 3) | All transaction reads start at `payments`; `payments.status` is the only lifecycle field; refunds/disputes are `adjustmentStatus` | Building or changing any transaction/reporting read |

Accepted ADRs are preserved even after implementation moves on — they record why a
decision holds.

## 4. Domain guidance

| Document | Authority | Purpose | Read it when |
|---|---|---|---|
| [`domains/solana-wallet-routing.md`](./domains/solana-wallet-routing.md) | Active domain contract | The per-wallet `MobileOpenStrategy` registry: which wallets use `solana:` URI, Phantom browser, Solflare universal link, deeplink, or WalletConnect | Changing Solana wallet selection or launch behavior |

## 5. API contracts

| Document | Authority | Purpose | Read it when |
|---|---|---|---|
| [`api/openapi.yaml`](./api/openapi.yaml) | **Executable truth** (level 4) | The public REST contract. Test-enforced. | Changing any public endpoint |
| [`api/index.md`](./api/index.md) | Active | API reference entry point. Test-enforced. | Orienting in the public API |
| [`api/overview.md`](./api/overview.md) | Active | Route inventory by classification, including which webhook routes exist. Test-enforced. | Deciding whether a route is public, internal, or retired |
| [`api/quickstart.md`](./api/quickstart.md) | Active | Shortest path to a working integration. Test-enforced. | Onboarding an integrator |
| [`api/authentication.md`](./api/authentication.md) | Active | API authentication. Test-enforced. | Touching API auth |
| [`api/api-keys.md`](./api/api-keys.md) | Active | Key lifecycle and scopes | Touching keys |
| [`api/idempotency.md`](./api/idempotency.md) | Active | Idempotency contract | Adding a mutating endpoint |
| [`api/errors.md`](./api/errors.md) | Active | Error taxonomy | Adding or changing an error |
| [`api/payments.md`](./api/payments.md) | Active | Payment object | Touching payment responses |
| [`api/payment-states.md`](./api/payment-states.md) | Active | Engine/API/provider/merchant status separation. Test-enforced. | Mapping status across boundaries |
| [`api/payment-intents.md`](./api/payment-intents.md) | Active (internal) | Internal hosted-checkout intent routes; verified against `app/api/payment-intents/` | Working on hosted checkout runtime |
| [`api/checkout-sessions.md`](./api/checkout-sessions.md) | Active | Hosted checkout API | Touching checkout sessions |
| [`api/rails-and-assets.md`](./api/rails-and-assets.md) | Active | Supported rails and assets. Test-enforced. | Adding a rail or asset |
| [`api/transactions.md`](./api/transactions.md) | Active | Transaction reads | Building transaction surfaces |
| [`api/receipts.md`](./api/receipts.md) | Active | Receipts | Touching receipts |
| [`api/webhooks.md`](./api/webhooks.md) | Active | Outbound merchant webhook delivery, signature headers, HMAC construction, timestamp tolerance | Touching merchant webhook delivery |
| [`api/webhook-events.md`](./api/webhook-events.md) | Active | Supported event catalog. Test-enforced. | Adding or renaming an event |
| [`api/webhook-deliveries.md`](./api/webhook-deliveries.md) | Active | Delivery monitoring and retry | Touching delivery or retry |
| [`api/version-strategy.md`](./api/version-strategy.md) | Active | API versioning and the 1.0 GA criteria | Planning a breaking change |
| [`api/partner-api-summary.md`](./api/partner-api-summary.md) | Active | Partner-facing summary | Talking to a partner |
| [`api/sdks.md`](./api/sdks.md) | Active | SDK index. Test-enforced. | Choosing an SDK |
| [`api/node-sdk.md`](./api/node-sdk.md) | Active | Published `@pinetreepayments/node` surface | Using or changing the Node SDK |
| [`api/browser-sdk.md`](./api/browser-sdk.md) | Active | Published `@pinetreepayments/js` | Using or changing the browser SDK |
| [`api/react-sdk.md`](./api/react-sdk.md) | Active | Published `@pinetreepayments/react` | Using or changing the React SDK |
| [`api/testing.md`](./api/testing.md) | Active | Test-mode guidance | Writing integration tests |

### API examples

Worked, self-contained integration examples. Read one when implementing that
exact flow.

- [`api/examples/rest-create-session.md`](./api/examples/rest-create-session.md)
- [`api/examples/rest-webhook-verification.md`](./api/examples/rest-webhook-verification.md)
- [`api/examples/node-create-session.md`](./api/examples/node-create-session.md)
- [`api/examples/node-webhook-verification.md`](./api/examples/node-webhook-verification.md)
- [`api/examples/session-lifecycle.md`](./api/examples/session-lifecycle.md)

### Presentation reference

Captured third-party developer pages kept as layout reference and pinned by
wording tests. **Non-normative** — per
[Standard 06 §6](./standards/06-roadmap-documentation-governance.md#6-change-control)
they must not define payment finality, ledger, provider, or security behavior.

- `api/squarespace-api-docs.html`
- `api/squarespace-developer-page.html`

## 6. Security

| Document | Authority | Purpose | Read it when |
|---|---|---|---|
| [`security/route-auth-matrix.md`](./security/route-auth-matrix.md) | **Executable truth** (level 4) | Authentication class per API route. Test-enforced. | Adding a route or changing its auth |
| [`security/webhook-verification-fail-closed.md`](./security/webhook-verification-fail-closed.md) | **Security decision record** (level 3) | Why webhook verification fails closed, why the generic provider route is retired, Coinbase retirement, constant-time Alchemy comparison | Touching any webhook verification path |
| [`security/dependency-risk-register.md`](./security/dependency-risk-register.md) | Active register | Known dependency risks and their status | Adding or upgrading a dependency |
| [`auth/supabase-email-templates.md`](./auth/supabase-email-templates.md) | Active | Supabase auth email templates. Test-enforced. | Touching auth emails or recovery |

## 7. Provider integration

| Document | Authority | Purpose | Read it when |
|---|---|---|---|
| [`api/provider-integration.md`](./api/provider-integration.md) | Active contract | Partner-facing adapter model, fee capture methods, fail-closed verification requirements | Adding or reviewing a provider adapter |
| [`architecture/shift4-integration-architecture.md`](./architecture/shift4-integration-architecture.md) | Active contract | Shift4 boundary, credential model, Commerce Engine For Cloud deployment, pinned OpenAPI version. Test-enforced. | Any Shift4 work |
| [`architecture/shift4-route-matrix.md`](./architecture/shift4-route-matrix.md) | Active contract | Shift4 route inventory. Test-enforced. | Adding a Shift4 route |
| [`architecture/shift4-reachability-inventory.md`](./architecture/shift4-reachability-inventory.md) | Active contract | Which Shift4 paths are reachable. Test-enforced. | Verifying Shift4 surface area |
| [`providers/fluidpay-provider-contract-checklist.md`](./providers/fluidpay-provider-contract-checklist.md) | Approved contract | FluidPay adapter requirements. Retained pre-launch as the approved integration contract. | FluidPay work |
| [`../integrations/shopify/SETUP.md`](../integrations/shopify/SETUP.md) | Active | Shopify connector setup | Shopify work |
| [`stripe-terminal-phase-2.md`](./stripe-terminal-phase-2.md) | Active contract | Stripe Terminal charge model, connected-account context for manual entry, native-app boundary | Stripe Terminal or POS card work |
| [`onboarding/business-verification.md`](./onboarding/business-verification.md) | Active contract | PineTree business verification and the Bridge consent boundary | Onboarding or Bridge work |

## 8. Environment and deployment

| Document | Purpose | Read it when |
|---|---|---|
| [`environment/staging-setup.md`](./environment/staging-setup.md) | Staging bring-up. Test-enforced. | Standing up staging |
| [`environment/dynamic-external-jwt-setup.md`](./environment/dynamic-external-jwt-setup.md) | Dynamic external JWT configuration | Wallet auth setup |
| [`environment/bridge-env-checklist.md`](./environment/bridge-env-checklist.md) | Stripe Bridge environment | Bridge setup |
| [`environment/speed-credentials-env-checklist.md`](./environment/speed-credentials-env-checklist.md) | Speed credentials (referenced by `.env.example`) | Speed setup |
| [`environment/lightning-sweep-env-checklist.md`](./environment/lightning-sweep-env-checklist.md) | Lightning sweep environment | Lightning payout setup |
| [`environment/bitcoin-fee-settlement.md`](./environment/bitcoin-fee-settlement.md) | BTC fee settlement. Test-enforced; cited by four source files. | Bitcoin fee work |
| [`environment/shift4-rest-env-checklist.md`](./environment/shift4-rest-env-checklist.md) | Shift4 REST environment | Shift4 setup |
| [`environment/shift4-feature-flags.md`](./environment/shift4-feature-flags.md) | Shift4 feature flags | Enabling Shift4 behavior |
| [`environment/shift4-onboarding.md`](./environment/shift4-onboarding.md) | Shift4 merchant onboarding | Onboarding a Shift4 merchant |
| [`environment/shopify-env-checklist.md`](./environment/shopify-env-checklist.md) | Shopify connector environment | Shopify setup |

## 9. Operations and runbooks

| Document | Purpose | Read it when |
|---|---|---|
| [`api/go-live-checklist.md`](./api/go-live-checklist.md) | Production go-live gate, incl. the 1.0 GA readiness criteria | Before a production launch |
| [`environment/shift4-phase-2-rollout.md`](./environment/shift4-phase-2-rollout.md) | Shift4 rollout procedure | Rolling out Shift4 |
| [`environment/shift4-production-readiness-checklist.md`](./environment/shift4-production-readiness-checklist.md) | Shift4 production gate | Before enabling Shift4 in production |
| [`environment/shift4-staging-database-execution.md`](./environment/shift4-staging-database-execution.md) | Applying Shift4 database releases to staging | Applying a Shift4 DB release |
| [`../artifacts/shift4-database/06-operator-checklist.md`](../artifacts/shift4-database/06-operator-checklist.md) | Operator steps for the Shift4 database release | Executing that release |
| [`../scripts/shift4-database/README.md`](../scripts/shift4-database/README.md) | Shift4 database release tooling | Running the release script |
| [`api/local-stack-release-validation.md`](./api/local-stack-release-validation.md) | Validating a release against a local stack | Pre-release validation |

## 10. Testing and certification

| Document | Purpose | Read it when |
|---|---|---|
| [`environment/shift4-certification-runbook.md`](./environment/shift4-certification-runbook.md) | Shift4 certification procedure. Defines required certification behavior. | Preparing or running certification |
| [`environment/woocommerce-test-checklist.md`](./environment/woocommerce-test-checklist.md) | WooCommerce validation. Test-enforced. | WooCommerce release |
| [`api/node-sdk-integration-testing.md`](./api/node-sdk-integration-testing.md) | Node SDK integration tests | Running SDK integration tests |
| [`api/react-sdk-integration-testing.md`](./api/react-sdk-integration-testing.md) | React SDK integration tests | Running React SDK tests |
| [`api/node-sdk-release-checklist.md`](./api/node-sdk-release-checklist.md) | Node SDK release gate: migrations, env, supported Node versions | Before cutting an SDK release |
| [`api/npm-publish-checklist.md`](./api/npm-publish-checklist.md) | npm publishing mechanics | Publishing a package |

## 11. Documentation governance

| Document | Purpose |
|---|---|
| [`standards/README.md`](./standards/README.md) | Authority order and the divergence register (open items D-2, D-3, D-4) |
| [`standards/06-roadmap-documentation-governance.md`](./standards/06-roadmap-documentation-governance.md) | Documentation hierarchy and change control |
| [`../.ai/task-map.json`](../.ai/task-map.json) | Path and keyword routing table |
| [`../.ai/workflows/`](../.ai/workflows/) | Implement, debug, review, refactor workflows |

### Rules

1. **Add every new document to this index in the same change that creates it**, per
   [Standard 06 §4](./standards/06-roadmap-documentation-governance.md#4-standard-definition-of-done).
2. **Do not add a parallel prompt or skills directory.** Extend the standards, or
   add a document under [`domains/`](./domains/).
3. **Do not keep a superseded document with a "superseded" label.** Move any unique
   authoritative decision into a standard, an ADR, or an active contract, then
   delete the file.
4. **Historical reports are not guidance.** Implementation logs, dated audits, and
   readiness snapshots do not belong here; capture the decision, drop the
   narrative.
5. `npm run ai:governance:check` enforces that every routed and indexed path
   resolves and that retired documents stay retired.
