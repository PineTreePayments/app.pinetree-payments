# Shift4 Phase 2 implementation report

Date: 2026-08-01
Repository: `C:\Users\andri\Desktop\app.pinetree-payments`

1. **Baseline and backup.** Work began at `3f70c4a6237ae18604f5cbfdae76585a05e2389c`; divergence from the requested short baseline `3f70c4a` was `0 0`. Before editing, the complete in-scope working set was copied outside the repository to `C:\Users\andri\Desktop\PineTree-Shift4-Backups\20260801-064234`. All 30 payload files were re-hashed against `SHA256SUMS.txt`. The directory contains 31 files including the manifest. An earlier incomplete directory, `20260801-064218`, was left untouched and is not the verified backup.

2. **Sources and official documentation.** All nine supplied source files were read: the six PineTree standards DOCX files, Retail Integration Plan v1.2, the Ecom test workbook, and the Retail test workbook. Every workbook sheet was inspected. Current Shift4 REST documentation was checked for Manual Authorization, Merchant Information, referral response data, partial authorization, and split-tender behavior. Where public search could not expose the certification REST specification precisely, the supplied integration plan/test workbooks remained the governing source; no endpoint was inferred beyond those sources.

3. **Starting and current Git state.** The repository already contained an uncommitted Phase 2 working set. It remains intentionally uncommitted. Current `HEAD` is unchanged at `3f70c4a6237ae18604f5cbfdae76585a05e2389c`, divergence is still `0 0`, and the final working tree contains six modified tracked files plus the new Phase 2 files listed in item 23.

4. **Database authority for payment totals.** `create_shift4_payment_attempt` locks `public.payments`, reads `gross_amount` and currency from that row, validates USD/CAD, requires an exact two-decimal conversion, rejects non-positive or JavaScript-unsafe minor-unit totals, and stores that database-derived total in the tender group. The caller parameter `p_payment_requested_amount_minor` does not exist.

5. **Engine money contract.** `Shift4ExecuteRequest` accepts `amountMinor` and optional minor-unit tax/tip/surcharge values. The execution boundary requires a positive `Number.isSafeInteger` amount and USD/CAD. The payment read is tenancy/context verification only; application code cannot supply the authoritative payment total to the RPC.

6. **Provider serializer.** `minorUnitsToShift4Amount` is the single Shift4 REST outbound money serializer. Transaction totals accept only safe positive integers for USD/CAD. An explicit option permits zero only for required tax/tip/surcharge components. It builds the decimal representation with string arithmetic and never rounds or multiplies a floating-point major-unit amount. Tests cover `1 → 0.01`, `15 → 0.15`, `11161 → 111.61`, `21900 → 219`, and `99999801 → 999998.01`.

7. **Response normalization.** `approvedAmountMinor` is derived strictly from `String(result.amount.total)`. Plain non-negative decimal syntax with no more than two fractional digits is accepted. Negative, exponent, malformed, excessive-precision, and unsafe values are rejected without `parseFloat`, coercive rounding, or `Math.round`; a malformed approved/partial response becomes an unknown outcome requiring lookup.

8. **Evidence mapper.** The mapper uses whole minor units, has no `postsLedger` decision, and distinguishes complete, under-, and over-approval evidence. A valid `P` partial sale remains `PROCESSING` with `remaining_tender_required`; contradictory or over-total evidence requires reconciliation.

9. **Database-returned state.** The evidence RPC returns persisted `attempt_state`, `attempt_recovery_state`, `attempt_resolution_reason`, `attempt_next_check_at`, and `tender_group_state`. The Engine returns those stored values instead of predicting database state.

10. **Journal schema and privileges.** The canonical journal migration creates accounts, transactions, immutable double-entry lines, links, balancing enforcement, identity constraints, RLS, and fail-closed privileges. Functions use `SECURITY DEFINER` with a fixed `search_path`; public/anon/authenticated execution is revoked, application RPC execution is granted only to `service_role`, and the direct journal helpers are also revoked from `service_role` so only the owning evidence function can post.

11. **Journal idempotency.** Posting identity is a unique `(posting_key, posting_version)` pair. A replay returns the existing transaction only when the complete immutable identity matches; otherwise it fails rather than conflating different financial effects.

12. **Account and link integrity.** Account resolution verifies active status plus matching unit/precision both on normal reads and unique-race recovery. Journal posting verifies account currency/network/unit/precision and validates that payment-event links exist and belong to the linked payment.

13. **Manual Authorization.** Backend-only `POST /transactions/manualauthorization` support is implemented. It requires explicit `certificationScopeConfirmed: true`, an exact six-character alphanumeric authorization code, a related referral attempt, and the referral's original invoice. The code is excluded from diagnostics and normalized evidence.

14. **Merchant Information.** Backend-only `GET /merchants/merchant` support is implemented behind the same explicit certification-scope gate. It has no UI or public route exposure.

15. **Referral flow.** Referral response evidence persists bounded voice-center account/phone fields from `result.merchant.voiceCenter`. A manual authorization is linked to the referral chain and reuses its invoice, preserving certification continuity.

16. **Partial authorization.** Partial response code `P` and `amount.total` are normalized and persisted. Partial sale evidence advances the tender aggregate without falsely confirming or failing the overall payment.

17. **Split tender.** Tender groups allocate ordered tender sequence numbers under a row lock. Each attempt retains a unique Shift4 invoice. The aggregate settles only when approved sale/capture evidence exactly equals the database-authoritative payment total; below-total stays open and above-total is reconciliation-required.

18. **Sale/capture journal postings.** Each settlement effect posts provider-clearing debit and merchant-gross-receivable credit in the same database transaction as evidence application. Posting keys are `shift4.<operation>.v1|<merchant>|<attempt>` so each real tender settles once.

19. **Platform fee.** Exact payment completion posts one balanced 15-minor-unit fee transaction per PineTree payment: merchant gross receivable debit and PineTree platform fee receivable credit. Its key is `shift4.platform_fee.v1|<merchant>|<payment>` and pricing version is `pinetree.standard.v1`. A total below the fixed fee is routed to reconciliation rather than producing a negative merchant balance.

20. **Legacy ledger compatibility.** `public.ledger_entries` is written only at exact overall payment confirmation. It remains a compatibility projection for existing readers; the canonical journal is the financial authority.

21. **Void/refund boundaries.** Authorization never posts inbound settlement. Void never confirms a payment or erases earlier evidence. Refund does not post an inbound sale/capture journal effect or mutate the inbound payment lifecycle in this phase; reversal/refund accounting is deliberately deferred to its dedicated lifecycle design.

22. **SQL/RPC signatures.** New migrations use fail-fast `create function`, not permissive replacement. Important signatures are `resolve_ledger_account(text,text,text,text,text,text,integer)`, `post_ledger_transaction(text,text,text,text,uuid,text,jsonb,jsonb,text,date,timestamptz,text,text,uuid,text,integer)`, `create_shift4_payment_attempt(text,uuid,uuid,uuid,text,text,varchar,bigint,varchar,text,text,text,text,text,bigint,text,integer,text,text,text)`, `consume_shift4_tokenization_session(uuid,uuid,text,text)`, `create_shift4_onboarding_session(uuid,uuid,text,text,text,text,text)`, `apply_shift4_onboarding_update(uuid,uuid,text,text,text,text,timestamptz,text,boolean,text)`, and `apply_shift4_attempt_evidence(...)` as declared in migration `20260731163100`. The create-attempt RPC contains no caller payment-total parameter. All REST database contracts require the exact internal provider key `shift4_rest`; bare `shift4` remains the separate legacy/customer-facing rail.

23. **Files changed/added.** The implementation scope is: three tests; two migrations; `database/shift4PaymentAttempts.ts`; this report and two architecture/rollout documents; eight `engine/shift4` modules; provider REST index/types/normalizer/request files; `money.ts`; Manual Authorization; Merchant Information; and the merchant/transaction barrel exports. Exact per-file inventory is in item 41.

24. **Test coverage.** Added/expanded tests cover strict inbound/outbound money handling, database total authority, SQL preflights and privileges, immutability, balancing, link integrity, idempotency, mapper state, unknown recovery, stored RPC state, referral/manual authorization, partial authorization, split tender, fee-once behavior, and certification gates.

25. **PostgreSQL runtime performed.** None. This workstation has no `psql`, Docker, Supabase CLI, or local PostgreSQL harness. SQL received static structural tests and review only. No claim is made that either migration was parsed or executed by PostgreSQL.

26. **Typecheck.** `npm run typecheck` passed with exit code 0 after the final source cleanup.

27. **Lint.** ESLint over the relevant Engine, database, provider, and test paths passed with exit code 0 and no findings.

28. **Focused tests.** `npm test -- __tests__/shift4RestFoundation.test.ts __tests__/shift4EnginePhase2.test.ts __tests__/ledgerJournalFoundation.test.ts` passed: 3 files, 324 tests, 0 failures.

29. **Full tests.** Final `npx vitest run --reporter=dot` passed: 325 files, 3,922 tests, 0 failures, exit code 0, Vitest duration 80.55 seconds.

30. **Build.** Final `npm run build` passed with exit code 0 in 282.8 seconds: optimized compilation completed in 2.6 minutes, TypeScript in 103 seconds, and all 195 static pages generated. An earlier invocation timed out at the command wrapper without a build result; two subsequent builds completed successfully. Benign bigint native-binding warnings fell back to pure JavaScript.

31. **Environment validation.** `npm run check:env` passed with zero required issues and printed no values. Shift4 REST variables and webhook secret are optional and missing. Warnings note production-looking application/Shopify URLs while `NODE_ENV` is development.

32. **Security review.** Scoped executable-code scans found no plaintext credential, PAN/CVV/track/PIN storage, no public certification helper import, no caller payment-total RPC parameter, no `postsLedger`, no Shift4 REST `parseFloat`/rounding path, no permissive replacement in the new migrations, and no unexpected public/anon/authenticated function grant. The new 14-digit migration versions have no collision. The older repository contains 14 groups of pre-existing duplicate date-only prefixes (for example, multiple `20260623_*` files); no existing migration was renamed because that would be an unrelated and potentially deployment-breaking change. Redacted payload digests and hashed idempotency keys remain the persisted diagnostic handles. Existing unrelated providers and legacy modules retain their pre-existing amount conversions and are outside this Shift4 Phase 2 scope.

33. **Blockers.** Database runtime, hosted RLS/catalog verification, Shift4 certification calls, and provider-live tests are blocked by intentionally unavailable local infrastructure/credentials and by the required operational approvals. They are deployment gates, not silently skipped successes.

34. **Hosted SQL.** No SQL was run against Supabase or any hosted database.

35. **Repository/external actions.** No commit, push, pull request, deployment, email, or live Shift4 transaction was performed.

36. **Migration paths.** Apply, in order: `database/migrations/20260731163000_create_ledger_journal_foundation.sql`, then `database/migrations/20260731163100_create_shift4_payment_attempts.sql`.

37. **Final migration SHA-256.** Journal: `240f7ba975f6e44e65c0d025e1717ade0b7b98080808d936008c30be95388a32`. Shift4 attempts: `87236c943c3eccfec8bdc8cc5ba9e03ebf4fede7ac21ab3129c7877d08438f26`.

38. **Backup path and hashes.** Verified backup: `C:\Users\andri\Desktop\PineTree-Shift4-Backups\20260801-064234`; manifest: `SHA256SUMS.txt` with 30 payload hashes. Its original journal migration hash is `404360e3e39ff6f11a9c3245b901e95fce4a4cdc78f38c92c5d00e3e6e612dc0`; original Shift4 migration hash is `092aeedfcb51e2a456f048594e3e990283d99cb6473681a14fbaee38bb589c56`.

39. **Final status.** `HEAD` remains the baseline. Tracked modifications: `__tests__/shift4RestFoundation.test.ts`, provider REST index, normalizer, transaction index/request, and types. All other implementation files in item 41 are untracked additions. No unrelated tracked file was modified.

40. **Diff statistics.** Git's tracked-only stat is 6 files changed, 148 insertions, 40 deletions. Because Git omits untracked files from `git diff --stat`, the complete implementation inventory before this report is 24 files and 12,838 physical text lines; this report is an additional documentation file.

41. **File line-count inventory.** Counts are physical lines from `@(Get-Content <file>).Count`; the report itself is excluded to avoid self-referential metadata.

    ```text
    534  __tests__/ledgerJournalFoundation.test.ts
    2506 __tests__/shift4EnginePhase2.test.ts
    1357 __tests__/shift4RestFoundation.test.ts
    950  database/migrations/20260731163000_create_ledger_journal_foundation.sql
    2870 database/migrations/20260731163100_create_shift4_payment_attempts.sql
    693  database/shift4PaymentAttempts.ts
    136  docs/architecture/adr-0001-ledger-journal-entries.md
    76   docs/environment/shift4-phase-2-rollout.md
    189  engine/shift4/attempt.ts
    669  engine/shift4/executeTransaction.ts
    54   engine/shift4/index.ts
    310  engine/shift4/mapShift4Evidence.ts
    260  engine/shift4/phase3Contracts.ts
    228  engine/shift4/reconcileShift4Payments.ts
    475  engine/shift4/recoverUnknownOutcome.ts
    205  engine/shift4/types.ts
    143  providers/shift4/rest/index.ts
    31   providers/shift4/rest/merchants/getMerchantInformation.ts
    36   providers/shift4/rest/money.ts
    456  providers/shift4/rest/normalizeResponse.ts
    141  providers/shift4/rest/transactions/index.ts
    41   providers/shift4/rest/transactions/manualAuthorization.ts
    135  providers/shift4/rest/transactions/request.ts
    343  providers/shift4/rest/types.ts
    ```

42. **Exact Supabase preflight SQL.** Run read-only as the intended migration owner and require every assertion to return the expected value before applying either file:

    ```sql
    select current_database(), current_user, current_setting('server_version');

    select rolname
    from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
    order by rolname;

    select to_regclass('public.payments') as payments,
           to_regclass('public.payment_events') as payment_events,
           to_regclass('public.merchant_provider_connections') as merchant_provider_connections,
           to_regclass('public.ledger_entries') as legacy_ledger_entries;

    select table_name, column_name, data_type, udt_name
    from information_schema.columns
    where table_schema = 'public'
      and (table_name, column_name) in (
        ('payments','id'), ('payments','merchant_id'),
        ('payments','gross_amount'), ('payments','currency'),
        ('payment_events','id'), ('payment_events','payment_id'),
        ('merchant_provider_connections','id'),
        ('merchant_provider_connections','merchant_id'),
        ('merchant_provider_connections','provider')
      )
    order by table_name, ordinal_position;

    select c.relname, c.relkind, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'ledger_accounts','ledger_transactions','ledger_journal_entries',
        'ledger_links','shift4_tender_groups','shift4_payment_attempts'
      )
    order by c.relname;
    ```

    Before a first deployment, the last query should return zero rows. If it returns any row, stop: the migrations intentionally fail rather than replacing or merging unknown objects.

43. **Deployment order.** Take a provider-supported backup/PITR point, run the preflight, then execute as the administrative migration owner with error stopping enabled:

    ```powershell
    psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/20260731163000_create_ledger_journal_foundation.sql
    psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/20260731163100_create_shift4_payment_attempts.sql
    ```

    Deploy backend code with all certification-only call paths disabled. Run staging smoke tests and obtain Shift4 scope approval before enabling those paths or recovery workers.

44. **Exact postflight and smoke SQL.** Run after both migrations; all exception counts must be zero and all listed tables must have RLS enabled:

    ```sql
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'ledger_accounts','ledger_transactions','ledger_journal_entries',
        'ledger_links','shift4_tender_groups','shift4_payment_attempts'
      )
    order by c.relname;

    select count(*) as unbalanced_transactions
    from (
      select ledger_transaction_id, currency_or_asset
      from public.ledger_journal_entries
      group by ledger_transaction_id, currency_or_asset
      having sum(case when side = 'debit' then amount_minor else 0 end)
          <> sum(case when side = 'credit' then amount_minor else 0 end)
    ) q;

    select count(*) as duplicate_posting_identities
    from (
      select posting_key, posting_version
      from public.ledger_transactions
      group by posting_key, posting_version
      having count(*) > 1
    ) q;

    select count(*) as duplicate_payment_fees
    from (
      select merchant_id, split_part(posting_key, '|', 3) as payment_id
      from public.ledger_transactions
      where event_type = 'shift4.platform_fee'
      group by merchant_id, split_part(posting_key, '|', 3)
      having count(*) > 1
    ) q;

    select count(*) as orphan_payment_links
    from public.ledger_links l
    left join public.payments p on p.id::text = l.entity_id
    where l.entity_type = 'payment' and p.id is null;

    select count(*) as forbidden_function_grants
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public'
      and p.proname in (
        'resolve_ledger_account','post_ledger_transaction',
        'create_shift4_payment_attempt','claim_due_shift4_payment_attempts',
        'apply_shift4_attempt_evidence','release_shift4_attempt_lease'
      )
      and a.privilege_type = 'EXECUTE'
      and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC','anon','authenticated');

    select state, recovery_state, count(*)
    from public.shift4_payment_attempts
    group by state, recovery_state
    order by state, recovery_state;

    select state, count(*)
    from public.shift4_tender_groups
    group by state
    order by state;
    ```

    Then exercise sanitized staging cases for full sale, auth/capture, partial plus remaining tender, duplicate evidence, timeout then invoice lookup, late success, manual referral resolution (only if approved), and fee-once behavior. Re-run all exception queries after every case.

45. **Rollback/containment.** Each file is transaction-wrapped, so a pre-commit failure rolls back that file. Fix the mismatch and restart at the first unapplied migration. After commit, do not drop or rewrite journal history: disable the Shift4 path and recovery workers, preserve evidence, and deploy a forward corrective migration. Use the recorded PITR point only for a platform-wide recovery decision. The legacy ledger projection remains available to existing readers.

46. **Proposed commit message only.** `feat(payments): complete Shift4 phase 2 authority, recovery, and journal foundation`
# Multi-phase implementation addendum (2026-08-01)

Phase 2 now has a feature-gated application boundary around it: centralized readiness, authenticated internal APIs, i4Go one-time tokenization sessions, hosted-checkout orchestration, manual-authorization gating, tender progress, retail device/Commerce Engine abstractions, deterministic certification simulator, workbook-derived 49-case manifest, internal read-only admin readiness, merchant readiness display, safe structured logging, and a disabled future encrypted card-on-file vault interface.

No hosted SQL was applied and no live Shift4 request was made. The Commerce Engine real transport and i4Go browser message/wire integration remain explicitly blocked on official interface documentation, credentials/devices, and certification authorization. See `docs/architecture/shift4-integration-architecture.md` and the environment runbooks for the current boundary.
## End-to-end completion addendum

- Added the provider-authoritative onboarding domain, safe session/event persistence, fixture updates, structured-email review boundary, and `20260801161000_create_shift4_onboarding_sessions.sql`.
- Replaced certification matrix-only validation with deterministic service/API/Engine/adapter/store execution for all 49 cases and JSON/CSV/Markdown evidence. Fixture execution asserts zero provider requests.
- Added grouped workflows for authorization/capture, approval/void, referral/manual authorization/capture, partial/additional tender, timeout/lookup, refund, and AVS/CSC.
- Added offline database release generation, centralized support diagnostics, nested dangerous-input redaction tests, and complete checkout/POS presentation states.
- Generic hosted-checkout discovery now removes Shift4 unless centralized `hosted_checkout` readiness passes. i4Go and Commerce Engine configuration remain explicit fail-closed prerequisites.

PostgreSQL runtime execution, i4Go wire certification, Commerce Engine device commands, real onboarding session creation, provider credentials, physical devices, and Shift4 analyst certification remain external. No hosted SQL or provider request was executed by this work.

## Final local consolidation

- Repaired the production bundle boundary by importing only `wagmi/connectors/walletConnect`; the broad connector barrel had pulled unused Base Account/Coinbase CDP x402 peers into the build.
- Moved a non-route helper out of an App Router `route.ts`, restoring the Next route export contract without changing behavior.
- Connected checkout, retail, onboarding, structured-email, attempt/tender/recovery, journal-reference, and canonical-result fixtures to the admin-only certification Engine and dashboard.
- Added stable fixture run IDs, manifest hashes, deterministic normalized evidence, route/reachability matrices, redaction torture coverage, and a seven-file database release package.
- `npm run build` now completes normally with all 196 static pages. Fixture completion remains internal validation, not Shift4 certification.
