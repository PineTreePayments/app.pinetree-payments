# Shift4 reachability inventory

Status: local source inventory. This document does not claim provider certification, database execution, or production enablement.

## Classification matrix

| Path or exact path set | Role | Importer / entry point | Runtime mode | Feature gate | External blocker |
|---|---|---|---|---|---|
| `app/api/admin/shift4/**/route.ts` | Admin readiness, onboarding inspection, and fixture certification routes | Next App Router; admin dashboard | internal/admin | admin role + `SHIFT4_CERTIFICATION_MODE` | None for fixtures; provider contracts for live mode |
| `app/api/internal/shift4/**/route.ts` | Merchant-scoped attempt, invoice, payment, recovery, tender, tokenization, onboarding, and readiness APIs | Next App Router | production-reachable but default blocked | merchant auth/scope + centralized capability gates | Credentials, certification, i4Go/Commerce Engine contracts |
| `app/api/webhooks/shift4/route.ts` | Existing verified event ingress | Shift4 webhook delivery | production-reachable, default blocked | webhook verification and event processor | Webhook secret/provider delivery |
| `app/dashboard/admin/shift4/page.tsx` | Canonical synthetic fixture console | admin navigation | internal/admin | admin route boundary | None for fixture mode |
| `components/payment/Shift4HostedCheckoutPanel.tsx` | State-only hosted checkout renderer | admin fixture console | internal fixture; future production UI | server-derived hosted-checkout readiness | Official i4Go session contract |
| `components/payment/Shift4RetailTerminalPanel.tsx` | State-only retail renderer | admin fixture console | internal fixture; future production UI | server-derived retail readiness | Commerce Engine/device contract |
| `components/dashboard/Shift4RestReadinessCard.tsx` | Merchant readiness display | provider settings page | production read-only | server readiness API | Credentials/certification |
| `lib/api/shift4Routes.ts` | Standard success/error envelope and input validation | all new Shift4 routes | server | route auth precedes use | None |
| `engine/shift4/attempt.ts`, `executeTransaction.ts`, `mapShift4Evidence.ts`, `recoverUnknownOutcome.ts`, `reconcileShift4Payments.ts`, `services.ts`, `tenders.ts`, `types.ts` | Canonical payment execution, durable state, recovery, reconciliation, and tender orchestration | internal routes/workers | production-reachable, default blocked | REST/auth/certification/channel/production readiness | Merchant credentials and certification |
| `engine/shift4/hostedCheckout.ts` | Token-session preparation, one-time consumption, and execution | internal tokenization routes | production-reachable, default blocked | hosted checkout + i4Go readiness | Official i4Go contract/configuration |
| `engine/shift4/retail.ts` | 60-second-capped device interaction Engine | certification service; future terminal action | fixture and future production | retail + terminal + Commerce Engine readiness | Official Commerce Engine commands/device |
| `engine/shift4/onboarding/*.ts` | Start/update/projection Engine | onboarding routes and readiness | fixture and future production | certification fixture or onboarding configuration | Hosted/status/webhook contract |
| `engine/shift4/certificationCatalog.ts`, `certificationService.ts` | 49-case selection, Engine fixture execution, stable IDs, safe evidence | admin certification route/tests | internal fixture | admin + certification mode | None for fixture mode |
| `engine/shift4/readiness.ts`, `diagnostics.ts`, `observability.ts` | Central capability state, explanations, safe logging | routes/settings/admin/Engine | server | all Shift4 feature gates | Provider/credential/device gates reflected, never bypassed |
| `engine/shift4/cardOnFileVault.ts` | Explicit disabled vault contract | focused tests; future documented adapter | intentionally blocked adapter | no enablement path | Official vault/token lifecycle contract |
| `engine/shift4/phase3Contracts.ts` | Provider-neutral wallet/card-on-file/retail future interfaces | focused tests and documentation | intentionally blocked adapter | no production selection | Official Phase 3 provider contracts |
| `engine/shift4/index.ts` | Intended server Engine barrel | server consumers | server only | inherited capability checks | None |
| `providers/shift4/rest/**` | Documented REST configuration, credentials, transport, normalization, redaction, invoice, merchant, and transaction adapters | Shift4 Engine | production-reachable, default blocked | REST flag + environment + credentials | Credentials/certification |
| `providers/shift4/i4go/**` | Browser configuration shape, session boundary, callback/token/origin validation | hosted-checkout Engine | intentionally blocked real adapter | hosted-checkout readiness | Official session creation/field contract |
| `providers/shift4/commerce-engine/client.ts` | Fail-closed real Commerce Engine client | future production composition | intentionally blocked adapter | Commerce Engine configured + retail readiness | Endpoint/auth/payload/device documentation |
| `providers/shift4/commerce-engine/simulator.ts`, `normalize.ts` | Synthetic device outcomes | certification Engine only | fixture-reachable | admin + certification fixture mode | None |
| `providers/shift4/commerce-engine/index.ts`, `errors.ts`, `types.ts` | Intended Commerce Engine contract barrel/types | retail Engine/certification service | server | inherited | None |
| `providers/shift4/onboarding/**` | Onboarding config, safe status normalization, synthetic fixtures, and email metadata sanitizer | onboarding Engine/certification service | fixture and future production | onboarding/certification gates | Hosted/status/email authenticity contract |
| `providers/shift4/pos/databaseAdapter.ts`, `index.ts`, `types.ts` | Terminal-reader persistence contract | documented future adapter/tests | intentionally blocked adapter | retail + terminal readiness | Physical device/Commerce Engine contract |
| `providers/shift4/adapter.ts`, `client.ts`, `constants.ts`, `payments.ts`, `paymentStatus.ts`, `translateEvent.ts`, `types.ts`, `verifyWebhook.ts`, `index.ts` | Existing Phase 1 provider registry/webhook adapter | provider registry/event processor | production-reachable, default blocked | existing connection/webhook gates | Credentials/webhook secret |
| `database/shift4PaymentAttempts.ts`, `shift4TenderGroups.ts`, `shift4TokenizationSessions.ts`, `shift4OnboardingSessions.ts` | Service-role persistence/RPC boundaries | Shift4 Engine/readiness | production server | tenancy rechecked by Engine/RPC | Four migrations must be applied by an operator |
| `database/migrations/20260731163000_create_ledger_journal_foundation.sql`, `20260731163100_create_shift4_payment_attempts.sql`, `20260801160000_create_shift4_tokenization_sessions.sql`, `20260801161000_create_shift4_onboarding_sessions.sql` | Strict ordered database release sources | approved migration operator only | deployment-only | release checklist | PostgreSQL runtime/authorization |
| `scripts/shift4-certification/*.mjs` | CLI API→Engine→adapter→store certification harness | npm fixture commands | fixture-only | hard fixture mode; live adapter absent | None for fixtures |
| `scripts/shift4-database/release.mjs` | Deterministic static release generator | `npm run shift4:database:release` | local release tooling | no database capability | PostgreSQL runtime for actual execution |
| `artifacts/shift4-database/00-manifest.json` through `06-operator-checklist.md` | Deterministic operator package | release operator | static/deployment | runtime status `not_executed` | Authorized PostgreSQL target |
| `__tests__/ledgerJournalFoundation.test.ts`, `__tests__/shift4*.test.ts` | Architecture, state, security, migration, and fixture contracts | Vitest | test-only | global provider isolation | None |

## Exact Shift4 source set

The classified set is every file under `engine/shift4/`, `providers/shift4/`, `app/api/admin/shift4/`, `app/api/internal/shift4/`, `scripts/shift4-certification/`, `scripts/shift4-database/`, and `artifacts/shift4-database/`, plus the exact route, component, database, migration, and test paths named above. The inventory test fails if a new file appears in those roots without a corresponding classified root.

## Dead-code conclusion

No accidental duplicate execution implementation remains. The obsolete, unreferenced `/api/shift4/apply` route and `engine/shift4Onboarding.ts` implementation were removed; onboarding now has one authenticated, readiness-gated internal Engine path. The hosted-checkout and retail panels are mounted only in the admin fixture console. The Commerce Engine simulator is consumed only by the certification Engine. `cardOnFileVault.ts`, `phase3Contracts.ts`, and the POS database adapter remain intentionally blocked interfaces with explicit future-adapter purposes; they are not production selections. No file is classified as unexplained dead code.
