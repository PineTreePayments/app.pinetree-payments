# Shift4 Retail pre-hardware readiness

Last audited: 2026-08-03. This document describes PineTree's software boundary before a physical Retail terminal is available. It is not a certification result and it does not authorize processing.

## Gap matrix

| Retail area | Status and boundary | Implementation files | Focused proof | More source work |
|---|---|---|---|---|
| POS Retail routing | Implemented at UI/API/Engine gates; no live Retail dispatch while the capability is disabled. | `components/pos/POSLayout.tsx`, `app/api/internal/shift4/payments/[operation]/route.ts`, `engine/shift4/services.ts`, `engine/shift4/readiness.ts` | `shift4RouteContracts`, `shift4EnginePhase2`, `posCardPaymentRoute` | Commerce Engine dispatch after documented hardware contract. |
| Multiple terminal selection | Implemented pre-hardware. POS lists and revalidates only merchant-owned Shift4 readers; default is first deterministically. | `components/pos/Shift4RetailReaderSelector.tsx`, `app/api/pos/shift4-retail-readers/route.ts`, `engine/shift4/retailTerminal.ts` | `shift4RetailPosSelection`, `shift4RetailTerminalReadiness` | Bind selected reader to documented device-session dispatch. |
| Authorization / capture / sale | Engine path implemented; Retail provider dispatch hardware-blocked. | `engine/shift4/executeTransaction.ts`, `providers/shift4/rest/transactions/request.ts`, `engine/shift4/mapShift4Evidence.ts` | `shift4EnginePhase2`, `shift4RestFoundation` | Physical-terminal execution and Shift4 certification. |
| Void | Implemented with exact attempt/invoice evidence; fixture proven. | `engine/shift4/executeTransaction.ts`, `providers/shift4/rest/invoices/voidInvoice.ts` | `shift4EnginePhase2`, certification `approval_void` workflow | Hardware/certification for Retail execution. |
| Card-present refund | Fixture-only/hardware-blocked: distinct refund invoice is modeled but card interaction requires a terminal. | `engine/shift4/executeTransaction.ts`, `scripts/shift4-certification/workflows.mjs` | `shift4EndToEndCompletion` | Documented Commerce Engine card-present refund command. |
| Token refund | Implemented at Engine/REST boundary; live execution certification-blocked. | `engine/shift4/cardOnFileVault.ts`, `engine/shift4/executeTransaction.ts` | `shift4EnginePhase2`, `shift4RestFoundation` | Shift4-approved token lifecycle/live case. |
| Referral/manual authorization | Implemented, certification-gated, fixture proven. | `engine/shift4/services.ts`, `providers/shift4/rest/transactions/manualAuthorization.ts`, `providers/shift4/rest/merchants/getMerchantInformation.ts` | `shift4EnginePhase2` | Analyst authorization and physical test execution. |
| Partial approval | Implemented through tender evidence; fixture-only for Retail. | `engine/shift4/tenders.ts`, `engine/shift4/mapShift4Evidence.ts` | `shift4EnginePhase2`, certification `partial_additional_tender` workflow | Hardware/certification. |
| Split tender | Implemented with distinct attempts and fee-once accounting; fixture-only for Retail. | `database/shift4TenderGroups.ts`, `engine/shift4/tenders.ts`, `database/shift4PaymentAttempts.ts` | `shift4EnginePhase2`, `ledgerJournalFoundation` | Hardware/certification. |
| Debit | Hardware-blocked. PineTree carries no PIN/debit encryption fields. | `engine/shift4/types.ts`, `providers/shift4/commerce-engine/*` | certification case `retail-evaluated-12` fixture boundary | Physical device and documented Commerce Engine command. |
| AVS/CSC | Implemented normalized evidence, fixture-proven. | `providers/shift4/rest/normalizeResponse.ts`, `engine/shift4/mapShift4Evidence.ts` | `shift4RestFoundation`, certification `avs_csc` workflow | Live analyst/certification evidence. |
| DCC | Documentation-blocked. | `providers/shift4/commerce-engine/client.ts`, `docs/architecture/shift4-integration-architecture.md` | `shift4FinalConsolidation` | Documented Shift4 Commerce Engine DCC contract. |
| Receipts | Implemented only for safe documented normalized evidence; rendering is outside adapter. | `providers/shift4/rest/normalizeResponse.ts`, `providers/shift4/rest/redact.ts` | `shift4RestFoundation` | Physical receipt formats/certification evidence. |
| Timeout recovery | Implemented/fixture-proven; no blind resend. | `engine/shift4/recoverUnknownOutcome.ts`, `engine/shift4/reconcileShift4Payments.ts`, `app/api/internal/shift4/recovery/route.ts` | `shift4EnginePhase2`, `shift4EndToEndCompletion` | Live Invoice Information behavior. |
| Exactly-once accounting | Implemented database contract and fixture/static tests; hosted SQL execution remains external. | `database/shift4PaymentAttempts.ts`, `database/shift4TenderGroups.ts`, `database/ledgerEntries.ts` | `ledgerJournalFoundation`, `shift4EnginePhase2` | Hosted migration/runtime verification. |
| Multiple MIDs | Implemented connection ownership enforcement, fixture-proven. | `database/merchantShift4RestConnections.ts`, `engine/shift4/services.ts` | `shift4CredentialConnection`, certification manifest case 2 | Shift4 assignment of actual additional MIDs. |
| Evaluated cases 1–18 | Catalog and synthetic execution implemented; hardware-required cases stop before dispatch. | `scripts/shift4-certification/manifest.mjs`, `fixture-engine.mjs`, `fixture-adapter.mjs` | `shift4EndToEndCompletion`, `shift4FinalConsolidation` | Physical test terminal and Shift4 direction. |
| Attest cases 19–26 | Catalog implemented; live controls intentionally disabled and analyst-approval-blocked. | `scripts/shift4-certification/manifest.mjs`, `engine/shift4/certificationService.ts` | `shift4EndToEndCompletion`, `shift4OperatorAuthorization` | Shift4 analyst approval. |

Multiple MIDs are represented by merchant-scoped provider connections. A request must match the authenticated merchant's active Shift4 connection; there is no browser-selected MID or credential.

## When terminals arrive

1. Verify the actual device model and assignment with Shift4.
2. Enter only the actual terminal identifiers in the authorized Admin Shift4 area.
3. Complete Commerce Engine provisioning and any documented connectivity operation.
4. Confirm local configuration, then enable the test Retail gate and certification mode through the approved operations process.
5. Run one controlled PineTree smoke request, validate LTM evidence, then run the analyst-directed Evaluated case.
6. Record official workbook evidence. Do not run Attest cases until Shift4 authorizes them.

Production remains blocked until certification, Shift4 approval, and piloting are complete.
