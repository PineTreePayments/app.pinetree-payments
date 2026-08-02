# Shift4 certification runbook

## Source control

The normalized manifest contains 23 e-commerce and 26 retail cases. It records the source workbook filenames and SHA-256 hashes. Original XLSX files remain unchanged.

Run safe local validation:

```powershell
npm run shift4:certification:verify
npm run shift4:certification:fixture
```

Fixture mode sends zero provider requests and writes ignored JSON, CSV, and Markdown reports under `artifacts/shift4-certification/`. Each case records a deterministic local fixture pass/fail result through the synthetic API/Engine/adapter/store path; that result is internal validation only, never provider execution or certification success.

Do not run the Attest sheets until the Shift4 analyst authorizes them. Never use a production merchant, credential, device, or card. The current live runner deliberately stops after validating gates because Commerce Engine/i4Go wire documentation and certification authorization remain external blockers.

## Evidence

Evidence may contain case ID, operation, timestamps, canonical outcome classification, response code, authorization reference, retrieval reference, integer approved amount, correlation ID, duration, and lookup/reconciliation flags. It must not contain access/auth tokens, client GUIDs, card tokens, access blocks, PAN, CVV/CSC, PIN, track data, full provider bodies, headers, manual authorization codes, or Voice Center data.

Timeout cases remain unresolved until invoice lookup supplies authoritative evidence. Do not void a failed/unknown request as cleanup and do not blindly resend. Signature case 26 expects approval with primary code 9551 and secondary code 4; collect a receipt signature and do not void solely for the device signature timeout.

## Internal dashboard

`/dashboard/admin/shift4` is the canonical admin-only synthetic environment and its API returns 404 unless certification mode is enabled. Admin authorization is role-based. It displays server-derived merchant readiness, supports one case, one grouped workflow, or all 49 cases, and renders checkout, retail, onboarding, email, attempt/tender/recovery, journal, and canonical-result fixture state. It cannot select the real adapter, mutate financial history, run provider commands, or reveal secrets.
## Complete fixture suite

Run `npm run shift4:fixtures:all`. The command exercises the deterministic API/Engine/adapter/store path for all 23 e-commerce and 26 retail cases and writes sanitized JSON, CSV, and Markdown evidence under ignored `artifacts/shift4-certification/`. A successful fixture run reports `providerRequestsSent: 0`.

Use `--case <id>` for one case or `--workflow <name>` for a grouped workflow. Non-fixture mode refuses execution unless the test environment, certification flag, credentials, merchant connection, `--confirm-test-environment`, `--confirm-provider-requests`, and an explicit case allowlist are present; the real certification adapter remains intentionally blocked until reviewed provider contracts exist.

Each run includes a stable run ID and manifest SHA-256. To compare two runs, remove only `startedAt` and `completedAt`; normalized content must match. Internal fixture success is not provider certification.
