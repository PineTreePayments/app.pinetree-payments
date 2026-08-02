# Shift4 staging database execution

Status: operator handoff only. The SQL package has been statically validated but has not been executed by PostgreSQL. No database was contacted while preparing this document.

## Controlled non-production procedure

1. Use a dedicated non-production Supabase branch or project with an authorized operator and an evidence location prepared in advance.
2. Do not use production for the first execution.
3. Keep every Shift4 feature flag `false`; this database exercise does not authorize provider traffic or production enablement.
4. Run `artifacts/shift4-database/01-preflight.sql` against the dedicated target.
5. Stop on any failed preflight condition. Record the failure and do not apply migrations.
6. Apply the migrations in exactly this order:
   1. `database/migrations/20260731163000_create_ledger_journal_foundation.sql`
   2. `database/migrations/20260731163100_create_shift4_payment_attempts.sql`
   3. `database/migrations/20260801160000_create_shift4_tokenization_sessions.sql`
   4. `database/migrations/20260801161000_create_shift4_onboarding_sessions.sql`
7. Run `artifacts/shift4-database/03-postflight.sql`.
8. Run `artifacts/shift4-database/04-smoke-tests.sql` using synthetic identifiers only.
9. Confirm that the smoke-test transaction rolls back and leaves no synthetic rows behind.
10. Record the PostgreSQL version, each migration result, function signatures, grants, RLS results, journal balance, duplicate behavior, cross-tenancy denial, fee-once behavior, and tokenization/onboarding idempotency.
11. Run the application fixture tests without enabling real provider traffic. Confirm all 49 cases pass and `providerRequestsSent` remains `0`.
12. Preserve command output, query results, timestamps, operator identity, target identity, hashes, and approvals in the designated evidence location. Do not preserve credentials.
13. On any failure, run `artifacts/shift4-database/05-containment.sql` as directed by the release package; use containment, not a destructive rollback.
14. Do not enable production until PostgreSQL evidence is approved and Shift4 certification is complete.

## Execution result checklist

- [ ] Dedicated non-production target identified: ____________________
- [ ] Operator and approval recorded: ____________________
- [ ] PostgreSQL version recorded: ____________________
- [ ] All Shift4 feature flags confirmed `false`
- [ ] Release manifest SHA-256 verified: ____________________
- [ ] Preflight passed; evidence reference: ____________________
- [ ] Ledger journal migration applied; result: ____________________
- [ ] Payment attempts migration applied; result: ____________________
- [ ] Tokenization sessions migration applied; result: ____________________
- [ ] Onboarding sessions migration applied; result: ____________________
- [ ] Function signatures verified; evidence reference: ____________________
- [ ] Grants and RLS verified; evidence reference: ____________________
- [ ] Journal balance verified; result: ____________________
- [ ] Duplicate behavior verified; result: ____________________
- [ ] Cross-tenancy denial verified; result: ____________________
- [ ] Fee applied once per overall payment; result: ____________________
- [ ] Tokenization idempotency verified; result: ____________________
- [ ] Onboarding idempotency verified; result: ____________________
- [ ] Postflight passed; evidence reference: ____________________
- [ ] Smoke tests used synthetic identifiers
- [ ] Smoke-test transaction rollback confirmed
- [ ] Fixture cases passed: ______ / 49
- [ ] Fixture `providerRequestsSent`: ______ (must be `0`)
- [ ] Evidence archive location recorded: ____________________
- [ ] Failures contained without destructive rollback, or N/A: ____________________
- [ ] Production remains disabled pending Shift4 certification
