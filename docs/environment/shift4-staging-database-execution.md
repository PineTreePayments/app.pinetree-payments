# Shift4 staging database execution

Status: corrective operator handoff. Migrations 1-5 are reported as deployed in the existing Supabase database. This locally regenerated package and its sixth forward-only journal-function correction have not been executed by this work; no database was contacted while preparing it.

The canonical internal merchant-provider key for this package is exactly `shift4_rest`. The bare `shift4` key remains the separate legacy/customer-facing rail and is not accepted by the attempts, tokenization, or onboarding database contracts. Onboarding updates use `apply_shift4_onboarding_update(uuid, uuid, text, text, text, text, timestamptz, text, boolean, text)`, with merchant-provider connection ID as the second argument.

## Controlled non-production procedure

1. Use the explicitly approved Supabase target with an authorized operator and an evidence location prepared in advance.
2. Verify the target already contains migrations 1-5 with the manifest hashes; do not rerun them.
3. Keep every Shift4 feature flag `false`; this database exercise does not authorize provider traffic or production enablement.
4. Run `artifacts/shift4-database/01-preflight.sql` against the dedicated target.
5. Stop on any failed preflight condition. Record the failure and do not apply migrations.
6. Verify the manifest order and hashes for all six migrations. Migrations 1-5 are deployed provenance; apply only `database/migrations/20260802030000_fix_ledger_posting_link_alias.sql`.
7. Run `artifacts/shift4-database/03-postflight.sql`.
8. Run `artifacts/shift4-database/04-smoke-tests.sql` without supplying merchant, payment, connection, credential, or customer data. It generates a unique synthetic merchant, one enabled `shift4_rest` connection with no real secrets, and two exact-money `CREATED` payments inside the outer transaction.
9. Confirm that S01-S19 pass, the final generated-fixture containment assertion passes, the explicit success row is returned, and the final `ROLLBACK` leaves no synthetic rows behind. Successful completion plus that rollback is the containment result; no same-transaction query can run afterward.
10. Record the PostgreSQL version, each migration result, function signatures, grants, RLS results, journal balance, duplicate behavior, cross-tenancy denial, payment/tender-group isolation, fee-once behavior, tender allocator nonmutation on rejected/resumed requests, and tokenization/onboarding full-identity idempotency.
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
- [ ] Deployed migrations 1-5 and hashes verified: ____________________
- [ ] Forward journal alias migration 6 applied; result: ____________________
- [ ] Exact journal function signature, owner, SECURITY DEFINER, search path, and grants verified: ____________________
- [ ] Grants and RLS verified; evidence reference: ____________________
- [ ] Journal balance verified; result: ____________________
- [ ] Duplicate behavior verified; result: ____________________
- [ ] Cross-tenancy denial verified; result: ____________________
- [ ] Fee applied once per overall payment; result: ____________________
- [ ] Tokenization idempotency verified; result: ____________________
- [ ] Tokenization changed-fingerprint replay rejected without overwrite: ____________________
- [ ] Onboarding idempotency verified; result: ____________________
- [ ] Onboarding session isolation verified: ____________________
- [ ] Rejected/resumed attempt left tender version/sequence/count unchanged: ____________________
- [ ] Postflight passed; evidence reference: ____________________
- [ ] Smoke test self-provisioned all rollback-only synthetic identifiers
- [ ] Final generated-fixture containment assertion passed
- [ ] Smoke-test transaction rollback confirmed
- [ ] Fixture cases passed: ______ / 49
- [ ] Fixture `providerRequestsSent`: ______ (must be `0`)
- [ ] Evidence archive location recorded: ____________________
- [ ] Failures contained without destructive rollback, or N/A: ____________________
- [ ] Production remains disabled pending Shift4 certification
