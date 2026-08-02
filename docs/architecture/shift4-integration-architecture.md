# Shift4 integration architecture

Status: server-side scaffolding and certification preparation; production disabled.

## Boundary

The only supported direction is:

`PineTree UI -> authenticated PineTree API -> PineTree Engine -> Shift4 adapter -> Shift4`

The browser never imports the REST or Commerce Engine adapters. Provider modules do not own PineTree payment state, tenant authorization, journal entries, or database policy. The database remains canonical for payments, attempts, tender totals, lifecycle transitions, and balanced journal posting.

## Readiness

`engine/shift4/readiness.ts` derives server-side capability states. An encrypted access token proves authentication only. Processing additionally requires the REST gate, channel gate, recorded certification evidence, environment permission, and—for retail—an online Shift4 terminal. Capabilities use explicit `enabled`, `disabled`, `blocked`, `certification_required`, and related states; no vague “available” state is used.

All flags default false. A production connection additionally requires `SHIFT4_PRODUCTION_ENABLED=true`. Browser controls cannot override readiness.

## E-commerce and i4Go

The i4Go adapter accepts administrator-provided HTTPS configuration only. It does not guess scripts, origins, field names, messages, or wire payloads. Its TypeScript contracts cannot represent PAN, CVV/CSC, track data, or PIN data.

Hosted checkout creates the PineTree payment first. The Engine reloads that payment, derives the exact integer minor-unit total from its authoritative gross amount, and creates a short-lived one-time tokenization session. The database stores a completion-secret hash and token fingerprint only. A raw token exists only transiently in server memory and is passed directly into the Engine. Duplicate completion with the same secret returns the durable attempt rather than retransmitting.

## Operations

Internal authenticated routes cover sale, authorization, full capture, void, refund, certified manual authorization, safe attempt/invoice reads, tender progress, and unknown-outcome recovery. Every mutation requires an idempotency key. Merchant identity comes from the verified bearer credential, never a request body. The Engine rechecks payment and connection ownership.

Manual authorization is a distinct attempt role, requires a six-character code, confirmed certification scope, referral lineage, the manual-authorization feature gate, and Merchant Information retrieved through the Engine. Voice Center information and authorization codes are not logged.

## Partial approval and split tender

Partial approval is durable provider evidence, not a new canonical payment status. The payment stays processing while an exact positive remainder exists. Each tender has its own chain/invoice. The database owns the requested total, sequence allocation, concurrency, exact-completion decision, and journal posting. A caller cannot move the target total or exceed the remainder. Full capture only is supported for each approved authorization.

## Retail

Retail uses the existing `merchant_terminal_locations` and `merchant_terminal_readers` identity. `Shift4PaxDeviceAdapter` handles device discovery, claim, and release. `Shift4CommerceEngineClient` is the transport seam. The deterministic simulator supports approval, decline, partial approval, referral, and timeout evidence.

The real Commerce Engine client deliberately throws `documentation_required`: official endpoint, authentication, device-session, and request/response schemas were not available in the reviewed sources. No guessed payload or device call exists. Retail interactions time out after no more than one minute and produce an unresolved/lookup-required result, never an automatic failure or blind resend.

## Recovery and events

No Shift4 webhook route was added. Exact signature/event documentation for this scope was not established. Invoice lookup and the leased recovery worker remain intentional authority. A timeout parks the attempt as unresolved without changing the canonical payment to failed. The worker waits the documented environment window, performs invoice lookup with bounded retries, and permits a same-invoice resend only after authoritative invoice-not-found evidence and policy checks.

## Ledger and fees

Provider attempts are evidence, not the ledger. The Phase 2 database function applies evidence, lifecycle transition, and balanced journal posting atomically. Split tenders post real-money movement per approved/captured tender, while PineTree's fee is assessed once for the completed payment—not once per tender. The configured fee remains $0.15 (15 minor units) under the governing ledger standard.

## Card on file

`Shift4EncryptedTokenVault` is an interface only. It includes merchant/connection ownership, encrypted envelope, fingerprint, provider transaction linkage, consent/use classification, expiration, and revocation. The shipped implementation is disabled and always fails closed. Card-on-file processing is not enabled.

## Observability

Shift4 logs use an allowlist of operational fields. Names resembling tokens, secrets, authorization data, card data, headers, bodies, or payloads are dropped. Raw provider responses, credentials, tokenization values, manual authorization codes, and Voice Center details are prohibited.
All Shift4 domains use the centralized allowlist in `engine/shift4/observability.ts`. Support diagnostics answer readiness, checkout/POS blockers, onboarding approval, certification, recovery, journal, remaining-tender, and tokenization questions without returning provider payloads or credentials.

## Merchant onboarding

Onboarding is a lifecycle distinct from payments: `not_started`, `draft`, `application_started`, `submitted`, `received`, `under_review`, `more_information_required`, `approved`, `declined`, `canceled`, `blocked`, or `error`. PineTree starts a provider-hosted application session and stores only safe operational identifiers/status timestamps; Shift4 remains the underwriter and approval authority.

The real adapter fails closed until Shift4 supplies the hosted/embedded session contract. Fixture updates traverse internal API → Engine → provider-normalization → service-role persistence. Structured email is only a sanitized adapter boundary with sender allowlisting, deduplication identity, attachment metadata counts, and mandatory manual review; Gmail is not connected and attachments are not persisted.

## Database release package

The final local package is the deterministic seven-file set `00-manifest.json` through `06-operator-checklist.md`. The generator performs **static source validation only**, records `runtimeStatus: not_executed`, and never opens a database connection.

## Reachability and internal fixture mode

`shift4-reachability-inventory.md` classifies production, internal/admin, fixture, test, deployment, and intentionally blocked code. `/dashboard/admin/shift4` is the only mounted checkout/POS fixture surface. Its admin action calls the certification Engine, which uses synthetic persistence and the Commerce Engine simulator, returns checkout/retail/onboarding state, and reports `providerRequestsSent: 0`. Public checkout and POS remain governed by real server readiness.

`npm run shift4:database:release` validates strict migration contracts and generates reviewed preflight, postflight, synthetic smoke-test, and containment SQL without database access. Runtime order is ledger → attempts/tenders → tokenization sessions → onboarding sessions/events. Containment disables all runtime flags while retaining attempts, journal entries, onboarding evidence, and safe reconciliation.
