# Shift4 production readiness checklist

Production is blocked until every applicable item is complete.

- [ ] The three migrations were reviewed and applied in order in an approved database change window.
- [ ] Preflight and postflight SQL passed with saved evidence.
- [ ] Every deployed migration hash matches the reviewed repository file.
- [ ] Service-role variables and Shift4 secret-envelope key are present only server-side.
- [ ] Official i4Go URLs/origin/application identity were provided and origin handling was tested.
- [ ] Official Commerce Engine endpoint, authentication, device-session, and payload contracts were implemented without inference.
- [ ] Shift4 test credentials and certified PAX devices were provisioned.
- [ ] Evaluated workbook cases passed and corrections were accepted.
- [ ] Shift4 analyst authorized Attest execution; all applicable Attest cases passed.
- [ ] Certification evidence was recorded on the merchant connection.
- [ ] E-commerce, retail, manual authorization, partial approval, split tender, Apple Pay, and Google Pay gates were enabled only for certified scope.
- [ ] Timeout, lookup, blank response, referral, host error, duplicate, and reconciliation alerts were exercised.
- [ ] Tenant ownership, RLS, grants, log redaction, idempotency, exact capture, exact tender total, balanced journal, and single-fee tests passed.
- [ ] No browser bundle contains service-role credentials, Shift4 access credentials, or provider adapter imports.
- [ ] Operational owners approved monitoring, recovery, containment, and support procedures.
- [ ] `SHIFT4_PRODUCTION_ENABLED=true` was set only after all prior approvals.

Rollback is feature containment first: set all Shift4 feature flags false and redeploy configuration. Do not delete attempts, tender groups, tokenization evidence, journal rows, or migrations. For an unresolved transaction, preserve the invoice and run controlled invoice lookup/reconciliation. Schema removal requires a separate reviewed forward migration and is not part of incident containment.
- [ ] Shift4 confirms whether merchant onboarding approval is required for this program and the merchant is `approved` when required.
- [ ] Official hosted/embedded onboarding URL or SDK, session request/result, application identifier, status query, outbound submission, bucket inbox/authentication, reply format, sensitive-data policy, status vocabulary, and webhook verification contracts are documented.
- [ ] `npm run shift4:database:release` passes; preflight/postflight/smoke artifacts receive human review before controlled execution.
- [ ] The onboarding migration is applied after the ledger, attempt/tender, and tokenization migrations.
- [ ] `npm run shift4:fixtures:all` passes all 49 cases with JSON/CSV/Markdown evidence and `providerRequestsSent = 0`.
- [ ] Commerce Engine configuration is reviewed, a real device is configured, the 120-second provider guidance vs PineTree one-minute UI inactivity policy is reconciled with Shift4, and lookup recovery is certified.
- [ ] i4Go script/origin/application configuration and callback contract are certified; no PAN/CSC enters PineTree.
- [ ] `npm run build` exits 0 through the normal repository command; internal fixture success and static database validation are recorded separately from provider certification and PostgreSQL execution.
- [ ] Route and reachability matrices are reviewed; no simulator or unfinished payment action is reachable from public production paths.
