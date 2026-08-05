# Shift4 integration architecture

Status: server-side scaffolding and certification preparation; production disabled.

## Boundary

The only supported direction is:

`PineTree UI -> authenticated PineTree API -> PineTree Engine -> Shift4 adapter -> Shift4`

The browser never imports the REST or Commerce Engine adapters. Provider modules do not own PineTree payment state, tenant authorization, journal entries, or database policy. The database remains canonical for payments, attempts, tender totals, lifecycle transitions, and balanced journal posting.

## Merchant credential connection

A merchant connects through `POST /api/internal/shift4/connect`, which runs the
Access Token Exchange along the standard layering: authenticated route →
`engine/shift4Connection.ts` → `providers/shift4/rest/credentials` → encrypted
storage in `database/merchantShift4RestConnections.ts`.

The Auth Token is a runtime-only input. It is never an environment variable,
never persisted, and never logged; only its SHA-256 hash is retained, as the
single-use replay key in `api_idempotency_claims`.

Retail and E-commerce each require their own exchange, because Shift4 scopes an
access token to one merchant account and interface. Both live in **one**
`shift4_rest` row — there are no `shift4_rest_retail` / `shift4_rest_ecommerce`
provider keys — under a versioned channel map in the existing `credentials`
JSONB:

```
{ provider_model, credential_version: 2,
  channels: { retail?: <credential>, ecommerce?: <credential> },
  legacy_shared?: <credential> }
```

Each channel credential holds its own AES-256-GCM envelope, so one exchange can
never overwrite the other's token. `legacy_shared` is a migrated version-1
document written before channels existed; it is readable only through the
explicit `allowLegacySharedCredential` compatibility path, never as a silent
fallback.

Access-token resolution requires the operation's channel. Retail operations use
the Retail token and E-commerce operations the E-commerce token, with no
cross-channel fallback; an ambiguous or missing credential fails closed. Before
decryption the stored credential's environment is compared to
`getShift4RestConfig().environment`, so a test token can never reach the
production host and a production token can never reach the test host.

## Readiness

`engine/shift4/readiness.ts` derives server-side capability states. An encrypted access token proves authentication only. Processing additionally requires the REST gate, channel gate, recorded certification evidence, environment permission, and—for retail—an online Shift4 terminal. Capabilities use explicit `enabled`, `disabled`, `blocked`, `certification_required`, and related states; no vague “available” state is used.

All flags default false. A production connection additionally requires `SHIFT4_PRODUCTION_ENABLED=true`. Browser controls cannot override readiness.

Readiness distinguishes five states and never conflates them. `not_configured`
means no credential is stored for the merchant at all; once any credential
exists the state is `configured`, even when the specific channel asked about is
the one still missing. Authentication is decided by whether a usable encrypted
credential is stored — clearing a credential strips its ciphertext, so a
disconnected or revoked row cannot read as authenticated. Channel-specific
capabilities are projected against that channel's own credential, so a Retail
token never makes E-commerce look ready, and the blocking reason names the one
gate that is failing. `authenticatedChannels` and `credentialPresent` expose
this to surfaces directly rather than making them infer it from the aggregate.

### Readiness is a client-fetched snapshot

`Shift4RestReadinessCard` fetches `GET /api/internal/shift4/readiness` in the
browser and holds the result in component state. A successful Access Token
Exchange performed by the sibling `Shift4RetailConnectCard` changes server state
that this snapshot cannot observe on its own.

The first Retail sandbox exchange demonstrated this concretely. Deployed request
timestamps show readiness fetched at 23:23:01, the exchange succeeding at
23:24:04, and the connect surface refreshing at 23:24:07 — with **no** readiness
request after the POST. The readiness card was therefore still rendering its
pre-exchange snapshot, taken when the merchant genuinely had no credential, which
is why it read `not configured` while the connection card correctly read
connected. The projection was correct; the component had simply not refetched.

The fix is an explicit one-shot refresh signal, not polling and not a retry:
`app/dashboard/providers/page.tsx` owns a `shift4ReadinessVersion` counter,
passes `onConnectionChanged` to the connect card, and passes the version to the
readiness card, whose effect is keyed on it. The callback fires exactly once and
only for a success — `shouldRefreshAfterOutcome` returns false for a failure,
a replayed token, and a timed-out or otherwise unclear outcome, because
refreshing on an unproven outcome would imply an exchange that may not have
happened. The callback takes no arguments, so no credential material crosses the
boundary. `router.refresh()` is deliberately not the mechanism: both cards own
client-fetched state that a server re-render would not update.

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

### Commerce Engine For Cloud

PineTree is a cloud-based POS, so it uses **Commerce Engine For Cloud**, not On-Premise. Both deployments share the hosted Shift4 URLs already used by Host Direct — test `https://api.shift4test.com/api/rest/v1`, production `https://api.shift4api.net/api/rest/v1` — and the same documented headers (`InterfaceVersion`, `InterfaceName`, `CompanyName`, `AccessToken`). There is deliberately no second HTTP stack: `providers/shift4/commerce-engine/cloud/` is pure request construction and response reading, and transport stays in `providers/shift4/rest/client.ts`.

**A Cloud request addresses the device by manufacturer and serial number, not by terminal ID.** The published `device` object is `{ cloud: true, manufacturer, serialNumber }`, where `manufacturer` is the enum `Ingenico | Innowi | PAX | Verifone | Castles | Miura` and `serialNumber` is at most 64 characters. The On-Premise variant of `/devices/getstatus` carries **no** `device` object at all (it is addressed by the local network URL), so the two bodies are not interchangeable. PineTree's stored `provider_reader_id` remains the Shift4-side terminal binding and PineTree's evidence key, but it is not a field in the Cloud request body.

`dateTime` is ISO 8601 **with a timezone offset, in the merchant's local time**. Server UTC is not used blindly; a trailing `Z` is rejected, because near midnight it would send the wrong local date.

#### Operation to integration method

| Operation | Endpoint | PineTree route | Why |
|---|---|---|---|
| Authorization | `POST /transactions/authorization` | Commerce Engine For Cloud | Card is read at the device. |
| Sale/Purchase | `POST /transactions/sale` | Commerce Engine For Cloud | Card is read at the device. |
| Card-present refund | `POST /transactions/refund` | Commerce Engine For Cloud | Requires a card interaction; `card.present` is required. |
| Capture | `POST /transactions/capture` | Host Direct | The published body offers only token variants — no Cloud variant. Capture needs no card interaction. |
| Void | `DELETE /transactions/invoice` | Host Direct (either by stage) | No request body; addressed by the `Invoice` header. |
| Invoice Information | `GET /transactions/invoice` | Host Direct (either by stage) | Read-only lookup, no body. |
| Manual authorization | `POST /transactions/manualauthorization` | Commerce Engine For Cloud **or** GTV token, selected server-side | The operation description publishes all four integration methods including Commerce Engine For Cloud. PineTree uses the GTV-token variant when the referral retained a card token (no second card read), otherwise the Cloud variant against the merchant-owned reader. |
| Device status | `POST /devices/getstatus` | Commerce Engine For Cloud | Published for On-Premise and Cloud only; there is no Host Direct server for this path. |
| Device Information | `GET /devices/info` | **Not used** | See the limitation below. |

The authoritative statement of supported integration methods is each operation's **description**, which publishes an explicit "Integration Methods" list — not the `servers` block. An earlier revision read the servers block and wrongly concluded manual authorization was Cloud-unsupported; for every transaction path the Commerce Engine For Cloud URLs are byte-identical to the Host Direct URLs, so their presence or absence in `servers` carries no meaning.

#### Manual Authorization and referral lineage

A referral is `transaction.responseCode = R`: the issuer will not approve without a phone call. Voice-centre contact details arrive via Merchant Information (`merchant.cardTypes`). The clerk telephones, receives a **six alphanumeric character** code, and submits it — Shift4 documents Manual Authorization and Manual Sale as the endpoints that carry it.

PineTree derives everything that identifies *which* transaction was approved from the persisted referral attempt: merchant, provider connection, invoice, amount, card token and Level 2 data. The browser sends only a PineTree payment reference and the six characters. That boundary is the security model — a caller who could choose the invoice or amount could attach a genuine phone approval to a different, larger transaction.

Variant selection is deterministic and server-side: a retained GTV token selects the token variant (no second card read); otherwise the Commerce Engine For Cloud variant runs against the merchant-owned reader. The browser never chooses an integration method, there is no fallback between variants after dispatch, and there is no automatic retry. The code is validated, uppercased, and kept out of general logs and browser responses.

##### The clerk's path through the POS

Authorization referral → clerk receives the voice authorization code → explicit Manual Authorization submission → the existing capture/reconciliation lifecycle. Nothing in that chain is new: the referral is ordinary persisted attempt evidence, and the submission re-enters the Engine at `POST /api/pos/shift4-manual-authorization`.

A referral leaves the sale genuinely PROCESSING while a human telephones the issuer, which the POS status poll cannot distinguish from any other processing sale. `POSLayout` therefore asks one extra, narrowly scoped question — `GET /api/pos/shift4-referral-status` — and opens `Shift4ManualAuthorizationPanel` inside the existing card view (`PosCardView` gains `shift4-referral`) when the server says yes. This is not a second payment-status system: the existing poll still owns whether the sale is processing, confirmed or failed.

- **The referral rules live in the Engine.** `classifyShift4ReferralState` (`engine/shift4/referralState.ts`) is a pure function over attempt lineage; the route is a thin authenticated adapter. Because it reads attempts **in chronological order**, an approved manual authorization, capture, void or replacement sale closes the workflow, a *declined* manual authorization deliberately does not (a wrong code must be re-enterable), and a genuinely new referral after a resolved one re-opens it.
- **The panel appears only from authoritative referral evidence.** The condition is the Engine's own referral test (`attempt_role = referral_authorization` or `responseCode = R`), server-validated, merchant-scoped, and restricted to `channel = retail`. A decline, a generic failure, an incomplete or timed-out attempt, a communication error, an unknown outcome, a cancelled attempt, an already-captured payment, a Shift4 E-commerce attempt and any non-Shift4 provider all leave it closed.
- **The check is scoped to Shift4 Retail sales, not to every card sale.** The terminal cannot know which provider owns the active sale — `/api/payments/status` is unauthenticated and returns only a status, and a browser-chosen provider string would not be evidence — so the first answer also reports `shift4Retail`. When that is false (every Stripe card sale) the POS stops asking for the rest of the sale rather than querying Shift4 every three seconds. It also stops as soon as a referral is found. Requests never overlap: one is in flight at a time, an `AbortController` cancels the outstanding request on cleanup, and a sale-generation check discards any answer belonging to a superseded sale.
- **The browser sends `paymentId` and `authorizationCode` only.** All Shift4 identity, invoice, amount, token, device and Level 2 data are server-derived from the persisted referral attempt; the panel never sees them.
- **Submission is always deliberate.** The panel has no effects, so nothing runs on mount or merely because a referral appeared. A synchronous in-flight ref means one click is one request, and there is no automatic retry. The typed code is cleared from browser state once submitted and on close, and never reaches a log.
- **Closing the panel is not a decision about the payment.** A clerk closes it to telephone the issuer or look something up. Closing sends no provider request and marks the payment neither confirmed, failed nor cancelled; while the referral is unresolved the processing screen keeps offering **Review voice authorization** to get back in, so the clerk is never stranded. The POS does not return to the keypad while the panel is open — the auto-reset timer arms only on a real terminal card result — and a status tick that still says "processing" cannot close the panel underneath a clerk mid-call.
- **Blocked is not approved.** `resolveManualAuthorizationOutcome` fails closed: only an explicit `dispatchPermitted: true` is reported as reaching Shift4. With the gates off the clerk is told the code was *validated locally but not sent*, that the payment is still unauthorized, and that the code was cleared for safety and must be re-entered once execution is enabled. An HTTP 200 alone is never rendered as an authorization.
- **Live execution remains gated.** With the Retail, certification, Commerce Engine and production gates off, the route validates the code and reports `dispatchPermitted: false` with a safe reason; no provider request, attempt, capture, fee or ledger posting is created. Hardware delivery, TMS assignment, Commerce Engine provisioning and certification remain the blockers.

**Not yet built.** There is currently no POS path that *creates* a Shift4 Retail payment — `startCard()` goes to Stripe, and `Shift4RetailReaderSelector` only reads readers and builds a non-dispatching preparation plan. The clerk workflow above is complete and tested end to end in code, but it cannot fire in production until a Shift4 Retail card rail exists. The post-dispatch half of the lifecycle (persisting the manual-authorization attempt against the referral's invoice and amount lineage, capture, and single fee posting) likewise remains future work behind the same gates.

#### Level 2 purchasing-card data

`transaction.purchaseCard` is **required** by the sale, authorization and manual-authorization schemas (both Cloud and GTV variants) and is **absent** from capture, refund, void and invoice information. PineTree builds it in `engine/shift4/purchaseCardData.ts` from its own records:

- `customerReference` (max 25) — merchant order reference, else a deterministic value derived from the payment id. Stable across retries, recovery and replay.
- `destinationPostalCode` (max 9) — shipping destination, else the terminal location, else the merchant's stored business address. **Fails closed** when none exists; no placeholder ZIP is ever generated.
- `productDescriptors` (1–4 entries, max 40 each) — real line-item names, else the order description, else the documented generic fallback `Retail Purchase`. Blanks and duplicates are removed and control characters stripped.

#### Device Information is not a cloud endpoint

`GET /devices/info` publishes only **Commerce Engine For On Premise** and **Locally Installed UTG** as its integration methods, and only the local UTG URL in `servers`. Commerce Engine For Cloud is absent. It is therefore not a cloud terminal-listing or auto-discovery endpoint, and PineTree does not use it as one. No terminal synchronization is invented: terminal identifiers still come from Shift4/TMS provisioning and are entered through the authorized Admin surface.

#### Device status normalization and freshness

`POST /devices/getstatus` returns `result[0].{cloudRegistered, cloudConnected, offlineMode}`. A terminal is reported **online only** for the exact combination `cloudRegistered = Y`, `cloudConnected = Y`, `offlineMode = N`. `cloudRegistered = N` maps to `unregistered`; `cloudConnected = N` or `offlineMode = Y` maps to `offline`; anything missing, contradictory, or the documented `offlineMode = "U"` maps to `unknown`. An HTTP 200 on its own never maps to online.

Evidence is persisted in the existing `merchant_terminal_readers` columns — no migration. The `status` column takes source-specific values (`shift4_online`, `shift4_offline`, `shift4_unregistered`, `shift4_unknown`) that cannot be confused with the locally written configuration strings, and `last_seen_at` is the evidence timestamp. Evidence is current for **five minutes**; past that it is downgraded to `unverified` and marked stale, so an expired "online" can never gate processing. PineTree does not poll — a status check is operator-initiated only.

The Commerce Engine dispatch seam now fails closed on `device_unavailable`, not `documentation_required`: the request contract is published and implemented, and what remains blocked is physical — terminal delivery, TMS assignment, Commerce Engine provisioning, and the Retail gate. Retail interactions time out after no more than one minute and produce an unresolved/lookup-required result, never an automatic failure or blind resend.

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

The final local package is the deterministic seven-file set `00-manifest.json` through `06-operator-checklist.md`. The generator statically validates package structure and generates an executable rollback-contained smoke script, but does not run that SQL: it records `runtimeStatus: not_executed`, `contactedDatabase: false`, and never opens a database connection. The four foundation migrations are installed in the current database; the fifth forward-only privilege migration records the manual correction and remains pending through the approved migration mechanism.

## Reachability and internal fixture mode

`shift4-reachability-inventory.md` classifies production, internal/admin, fixture, test, deployment, and intentionally blocked code. `/dashboard/admin/shift4` is the only mounted checkout/POS fixture surface. Its admin action calls the certification Engine, which uses synthetic persistence and the Commerce Engine simulator, returns checkout/retail/onboarding state, and reports `providerRequestsSent: 0`. Public checkout and POS remain governed by real server readiness.

`npm run shift4:database:release` validates strict migration contracts and generates reviewed preflight, postflight, executable synthetic smoke-test, and containment SQL without database access. Audited order is ledger → attempts/tenders → tokenization sessions → onboarding sessions/events → execute-privilege hardening. On the current database, do not rerun the installed first four; apply only the pending fifth migration. Containment disables all runtime flags while retaining attempts, journal entries, onboarding evidence, and safe reconciliation.
