# Shift4 Retail pre-hardware readiness

Last audited: 2026-08-04. This document describes PineTree's software boundary before a physical Retail terminal is available. It is not a certification result and it does not authorize processing.

Authoritative source for every contract statement below: Shift4 Payment API OpenAPI 3.1, version **1.7.58**, published at `https://docs.shift4.com/_bundle/apis/payments-platform-rest/openapi.yaml`, plus the guide at `https://docs.shift4.com/guides/device-functionality/commerce-engine`.

## Deployment

PineTree is a cloud-based POS and uses **Commerce Engine For Cloud**.

- Test: `https://api.shift4test.com/api/rest/v1`
- Production: `https://api.shift4api.net/api/rest/v1`
- Headers: `InterfaceVersion`, `InterfaceName`, `CompanyName`, `AccessToken`

Host Direct and Commerce Engine For Cloud share these hosts. Transport is the single shared REST client; the Cloud directory is pure request construction with no HTTP of its own.

**A Cloud request addresses the device by manufacturer and serial number.** `device` is `{ cloud: true, manufacturer, serialNumber }`. The On-Premise `/devices/getstatus` variant has no `device` object at all, so the two bodies are never interchangeable. A Shift4 terminal ID is not a Cloud request field; it remains the Shift4-side terminal binding and PineTree's evidence key.

`dateTime` is ISO 8601 with a timezone offset in the **merchant's local time**, taken from `merchant_settings.timezone`. A trailing `Z` is rejected.

## Supported devices

| Manufacturer | Models | Shift4 platform support | PineTree certification scope |
|---|---|---|---|
| PAX | A800, A6630, A35, A3700, IM30 | Documented | **In PineTree's current PAX certification plan** |
| Verifone | V660p, P630-A, UX700 | Documented | **Confirmation pending** — documented Commerce Engine device; PineTree certification scope not yet confirmed by Shift4 |

Verifone models are never displayed as "Unsupported" (Shift4 documents them) and never as "Certified" (Shift4 has not certified PineTree on them). A model outside this list is classified `unrecognized_model`: accepted safely, flagged for operator review, and still usable to build a request when the manufacturer resolves.

## Operation to integration method

| Operation | Endpoint | PineTree route | Basis |
|---|---|---|---|
| Authorization | `POST /transactions/authorization` | Commerce Engine For Cloud | Cloud body variant published; card read at device |
| Sale/Purchase | `POST /transactions/sale` | Commerce Engine For Cloud | Cloud body variant published; card read at device |
| Card-present refund | `POST /transactions/refund` | Commerce Engine For Cloud | Cloud body variant published; `card.present` required |
| Capture | `POST /transactions/capture` | Host Direct | No Cloud body variant — token variants only; no card interaction needed |
| Void | `DELETE /transactions/invoice` | Either by stage → Host Direct | No body; addressed by `Invoice` header |
| Invoice Information | `GET /transactions/invoice` | Either by stage → Host Direct | Read-only lookup, no body |
| Manual authorization | `POST /transactions/manualauthorization` | **Not supported for Cloud** | Spec ambiguity — a `comengcloud` body variant exists, but the path's `servers` block lists only Host Direct and locally installed UTG. The servers block is treated as authoritative. **Open question for Shift4.** |
| Device status | `POST /devices/getstatus` | Commerce Engine For Cloud | Published for On-Premise and Cloud only; no Host Direct server |
| Device Information | `GET /devices/info` | **Not used** | `servers` lists ONLY the locally installed UTG URL |

## Device Information limitation

`GET /devices/info` is published for locally installed UTG only. It is **not** a Commerce Engine For Cloud endpoint, **not** a cloud terminal-listing endpoint, and **not** an auto-discovery mechanism. PineTree does not call it and invents no terminal synchronization. Terminal identifiers come from Shift4/TMS provisioning and are entered through the authorized Admin surface.

## Device status normalization

`POST /devices/getstatus` returns `result[0].{cloudRegistered, cloudConnected, offlineMode}`.

| Evidence | Normalized state |
|---|---|
| `cloudRegistered=Y`, `cloudConnected=Y`, `offlineMode=N` | `online` — the only combination that qualifies |
| `cloudRegistered=N` | `unregistered` |
| `cloudConnected=N`, or `offlineMode=Y` | `offline` |
| any flag missing/undocumented, or `offlineMode=U` | `unknown` |
| no reader configured | `not_configured` |
| no check has run | `configured` (local configuration only) |

An HTTP 200 alone never maps to `online`. A configured terminal ID alone never maps to `online`. Beyond the device states, readiness still reports `disabled` while the Retail gate is off, `certification_required` before certification, and `enabled` only after every gate passes.

### Freshness policy

Evidence is persisted without a migration, in existing columns: `status` takes the namespaced values `shift4_online`, `shift4_offline`, `shift4_unregistered`, `shift4_unknown` — written **only** after a real `/devices/getstatus` response — and `last_seen_at` is the evidence timestamp. Local strings such as `configured` or `ready` are never read as provider evidence.

The freshness window is **5 minutes**. Past it, evidence is downgraded to `unverified` and marked stale; the timestamp is retained so the UI can still say when the check ran. Stale evidence never gates processing.

PineTree does **not** poll. Checks are operator-initiated only. In this phase the only surface is the Admin verification action.

## Selected-reader transaction preparation

The POS holds only a PineTree reader ID and sends only that. Merchant identity comes from the signed terminal session; provider, environment, channel, terminal ID, serial number and manufacturer are all resolved server-side. A raw Shift4 terminal ID cannot satisfy the PineTree row-id format and is rejected.

Preparation revalidates ownership, provider, non-simulation, serial presence, manufacturer resolution, local-disable status, recorded provider connectivity, environment, and the merchant's own Retail credential — then stops at the gate and reports `Awaiting Retail test enablement`. It creates no payment, no attempt, and no ledger entry, and dispatches nothing.

Two documented-required fields cannot be supplied yet and are reported rather than fabricated: `transaction.invoice` (requires a real payment attempt) and `transaction.purchaseCard` (the spec marks it required for sale and authorization while its own retail example omits it — **open question for Shift4**).

## Gap matrix

| Retail area | Status and boundary | Implementation files | Focused proof | More source work |
|---|---|---|---|---|
| Commerce Engine Cloud contract | Implemented from the published OpenAPI. | `providers/shift4/commerce-engine/cloud/*` | `shift4CommerceEngineCloud` | None; dispatch awaits hardware. |
| Device status | Implemented. One request per operator action, no retry. | `engine/shift4/deviceStatus.ts`, `providers/shift4/commerce-engine/cloud/deviceStatus.ts` | `shift4DeviceStatus` | A physical device to check. |
| Multiple terminal selection | Implemented. POS and Admin both revalidate merchant-owned readers; a multi-terminal check requires an explicit choice. | `components/pos/Shift4RetailReaderSelector.tsx`, `app/api/pos/shift4-retail-readers/route.ts`, `engine/shift4/retailTerminal.ts` | `shift4RetailPosSelection`, `shift4RetailTerminalReadiness` | None. |
| Selected-reader preparation | Implemented to the provider boundary; dispatch gated. | `engine/shift4/retailPreparation.ts`, `app/api/pos/shift4-retail-preparation/route.ts` | `shift4RetailPosPreparation` | Invoice derivation from a real attempt; `purchaseCard` clarification. |
| Authorization / capture / sale | Engine path implemented; Retail dispatch hardware-blocked. | `engine/shift4/executeTransaction.ts`, `providers/shift4/rest/transactions/request.ts` | `shift4EnginePhase2`, `shift4RestFoundation` | Physical-terminal execution and certification. |
| Void | Implemented with exact attempt/invoice evidence; fixture proven. | `engine/shift4/executeTransaction.ts`, `providers/shift4/rest/invoices/voidInvoice.ts` | `shift4EnginePhase2` | Hardware/certification. |
| Card-present refund | Cloud contract implemented; card interaction requires a terminal. | `providers/shift4/commerce-engine/cloud/transactionRequest.ts` | `shift4CommerceEngineCloud` | Physical terminal. |
| Token refund | Implemented at Engine/REST boundary; live execution certification-blocked. | `engine/shift4/cardOnFileVault.ts` | `shift4EnginePhase2` | Shift4-approved token lifecycle. |
| Referral/manual authorization | Implemented for Host Direct; **not routed through Cloud** pending Shift4 confirmation. | `engine/shift4/services.ts`, `providers/shift4/rest/transactions/manualAuthorization.ts` | `shift4EnginePhase2`, `shift4CommerceEngineCloud` | Shift4 confirmation of Cloud support. |
| Partial approval | Implemented through tender evidence; fixture-only for Retail. | `engine/shift4/tenders.ts` | `shift4EnginePhase2` | Hardware/certification. |
| Split tender | Implemented with distinct attempts and fee-once accounting. | `database/shift4TenderGroups.ts`, `engine/shift4/tenders.ts` | `shift4EnginePhase2`, `ledgerJournalFoundation` | Hardware/certification. |
| Debit | Hardware-blocked. PineTree carries no PIN/debit encryption fields. | `engine/shift4/types.ts` | certification case `retail-evaluated-12` | Physical device and documented command. |
| AVS/CSC | Implemented normalized evidence, fixture-proven. | `providers/shift4/rest/normalizeResponse.ts` | `shift4RestFoundation` | Live certification evidence. |
| DCC | Documentation-blocked. | `providers/shift4/commerce-engine/client.ts` | `shift4FinalConsolidation` | Documented Cloud DCC contract. |
| Receipts | Implemented for safe normalized evidence; rendering outside the adapter. | `providers/shift4/rest/normalizeResponse.ts` | `shift4RestFoundation` | Physical receipt formats. |
| Timeout recovery | Implemented/fixture-proven; no blind resend. | `engine/shift4/recoverUnknownOutcome.ts` | `shift4EnginePhase2` | Live Invoice Information behavior. |
| Exactly-once accounting | Implemented database contract and static tests. | `database/shift4PaymentAttempts.ts` | `ledgerJournalFoundation` | Hosted migration verification. |
| Multiple MIDs | Implemented connection ownership enforcement. | `database/merchantShift4RestConnections.ts` | `shift4CredentialConnection` | Shift4 assignment of additional MIDs. |
| Evaluated cases 1–18 | Catalog and synthetic execution implemented. | `scripts/shift4-certification/manifest.mjs` | `shift4EndToEndCompletion` | Physical test terminal. |
| Attest cases 19–26 | Catalog implemented; live controls disabled. | `engine/shift4/certificationService.ts` | `shift4OperatorAuthorization` | Shift4 analyst approval. |

Multiple MIDs are represented by merchant-scoped provider connections. A request must match the authenticated merchant's active Shift4 connection; there is no browser-selected MID or credential.

## When terminals arrive

1. Receive both physical devices.
2. Confirm the exact models against Shift4's published Commerce Engine device list.
3. Confirm the Shift4 TMS terminal assignments.
4. Enter or synchronize only the actual assigned identifiers — including the **device serial number**, which Commerce Engine For Cloud requires — through the approved Admin operational process.
5. Perform one explicit `POST /devices/getstatus` request per terminal.
6. Confirm `cloudRegistered`, `cloudConnected`, and `offlineMode` for each.
7. Enable only the Retail **test** gate.
8. Enable certification mode only when ready.
9. Perform one controlled PineTree test transaction.
10. Verify it in LTM.
11. Begin the Shift4 Evaluated certification tab.
12. Do not begin Attest cases until Shift4 authorizes them.

Production remains blocked until certification, Shift4 approval, and piloting are complete.

## Open questions for Shift4

1. **Manual authorization over Cloud** — a `comengcloud` request body variant is published, but the path's `servers` block omits Commerce Engine For Cloud. Which is authoritative?
2. **`transaction.purchaseCard`** — marked required for sale and authorization, yet omitted from the spec's own retail example. Is it required for an ordinary card-present retail sale?
3. **PineTree Verifone certification scope** — Shift4 documents V660p, P630-A and UX700 as Commerce Engine devices; is PineTree's certification scope extended to them, or is it PAX-only?
