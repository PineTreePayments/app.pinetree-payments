# Shift4 Phase 2 database rollout

Status: authored and statically verified; not executed against PostgreSQL in this workspace.

## Scope gate

Merchant Information and Manual Authorization are backend-only certification
helpers. They are not routed to UI or public API code. Each call requires the
literal `certificationScopeConfirmed: true`. Enable that call path only after
Shift4 confirms those endpoints are in the merchant/interface certification
scope. Never log or place the six-character manual authorization code in a URL,
header, general provider log, or exception diagnostic.

## Pre-deployment checks

```powershell
npm run typecheck
npx vitest run __tests__/ledgerJournalFoundation.test.ts __tests__/shift4EnginePhase2.test.ts __tests__/shift4RestFoundation.test.ts
npm test
npm run build
git diff --check
```

Take a provider-supported database backup/PITR recovery point. Confirm the
target has the `service_role`, `anon`, and `authenticated` roles and every
external table asserted by the migration preflights.

## Exact SQL order

Use the administrative migration owner. Both files contain `begin`, fail-fast
preflights, and `commit`; `ON_ERROR_STOP` prevents continuation after an error.

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/20260731163000_create_ledger_journal_foundation.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/20260731163100_create_shift4_payment_attempts.sql
```

Do not reverse the order or use a client that ignores errors. Do not apply from
this workstation until approved credentials and a disposable/staging target are
available.

## Post-deployment assertions

```sql
select to_regclass('public.ledger_accounts'),
       to_regclass('public.ledger_transactions'),
       to_regclass('public.ledger_journal_entries'),
       to_regclass('public.ledger_links'),
       to_regclass('public.shift4_tender_groups'),
       to_regclass('public.shift4_payment_attempts');

select count(*) as unbalanced_transactions
from (
  select ledger_transaction_id
  from public.ledger_journal_entries
  group by ledger_transaction_id, currency_or_asset
  having sum(case when side = 'debit' then amount_minor else 0 end)
       <> sum(case when side = 'credit' then amount_minor else 0 end)
) exceptions;
```

Exercise sanitized staging cases for full sale, authorization/capture, partial
sale plus remaining tender, duplicate evidence, unknown-outcome lookup, late
success, and the one-per-payment 15-minor-unit fee. Verify each transaction
balances and duplicate posting keys create no new lines.

## Rollback and containment

If a migration fails before `commit`, PostgreSQL rolls that file back. Fix the
preflight/schema mismatch and rerun from the first unapplied file.

After commit, do not drop or mutate journal history. Leave the backend-only
Shift4 path disabled, stop Shift4 recovery workers, and ship a forward corrective
migration. Restore the recorded recovery point only for a full-environment
incident under the platform recovery procedure. The legacy
`public.ledger_entries` table remains available to existing reports.
# Multi-phase rollout addendum (2026-08-01)

The controlled migration order is now:

1. `database/migrations/20260731163000_create_ledger_journal_foundation.sql`
2. `database/migrations/20260731163100_create_shift4_payment_attempts.sql`
3. `database/migrations/20260801160000_create_shift4_tokenization_sessions.sql`

Do not enable a Shift4 runtime flag before all required migrations and validation complete. Migration 3 is a strict first-deployment migration: collisions fail rather than being silently replaced. It revokes browser roles, grants only service-role select/insert/update, grants only service-role execution of its pinned-search-path consumption function, stores no raw card token, and provides no delete grant.

Preflight (read only):

```sql
select current_database(), current_user, current_setting('server_version');
select to_regclass('public.merchants'), to_regclass('public.payments'),
       to_regclass('public.merchant_providers'), to_regclass('public.ledger_journal_entries'),
       to_regclass('public.shift4_payment_attempts'), to_regclass('public.shift4_tokenization_sessions');
select rolname from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname;
select p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('post_ledger_journal_entry','create_shift4_payment_attempt','apply_shift4_attempt_evidence','consume_shift4_tokenization_session')
order by p.proname;
```

After applying all three files in one controlled serial session, run:

```sql
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in ('ledger_journal_entries','shift4_payment_attempts','shift4_tender_groups','shift4_tokenization_sessions')
order by tablename;
select grantee, table_name, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name like 'shift4_%' order by table_name, grantee, privilege_type;
select n.nspname, p.proname, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like '%shift4%' order by p.proname;
select conrelid::regclass, conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid in ('public.shift4_payment_attempts'::regclass,'public.shift4_tender_groups'::regclass,'public.shift4_tokenization_sessions'::regclass)
order by conrelid::regclass::text, conname;
begin;
set local role authenticated;
select count(*) from public.shift4_tokenization_sessions; -- must fail permission denied
rollback;
```

Smoke tests must use synthetic test-environment merchants/payments only. Verify a promoted authorization still resumes by stable operation identity; rejected and resumed requests leave tender-group version, next sequence, and attempt count unchanged; only P creates partial/additional-tender behavior; A/C amount mismatches block for reconciliation; one-time tokenization returns `consumed_now`, then `already_consumed` only for the same secret and fingerprint while a changed fingerprint conflicts without overwrite; wrong-merchant access fails; onboarding rejects cross-connection updates and conflicting update-reference reuse; exact tender completion confirms once; journal debits equal credits; and the $0.15 fee posts once per completed payment.

Containment is configuration-only: turn every Shift4 flag off. Preserve all financial and recovery evidence. Do not roll migrations back or delete rows during an incident. If schema containment is later required, author a new reviewed forward migration after reconciliation and backup.
## Offline release generation

Run `npm run shift4:database:release`. It performs no connection and regenerates:

- `artifacts/shift4-database/00-manifest.json`
- `artifacts/shift4-database/01-preflight.sql`
- `artifacts/shift4-database/02-apply-order.txt`
- `artifacts/shift4-database/03-postflight.sql`
- `artifacts/shift4-database/04-smoke-tests.sql`
- `artifacts/shift4-database/05-containment.sql`
- `artifacts/shift4-database/06-operator-checklist.md`

The first four migrations through `database/migrations/20260801161000_create_shift4_onboarding_sessions.sql` are already installed in the current Supabase database. The fifth migration, `database/migrations/20260802020000_harden_shift4_function_execute_privileges.sql`, is the pending forward-only record of the manually applied privilege correction. Verify the five-entry manifest, run preflight, apply only the fifth migration on the current database, run postflight, and then run the configured executable synthetic smoke test inside its rollback-only transaction. Do not treat artifact generation as runtime validation or rerun the installed foundation migrations.

The generator labels the result `static release-package validation; executable smoke SQL generated but not run locally`, records `runtimeStatus: not_executed` and `contactedDatabase: false`, and must produce identical hashes on consecutive runs.
