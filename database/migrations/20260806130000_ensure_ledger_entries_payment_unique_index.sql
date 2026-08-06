begin;

/* ══════════════════════════════════════════════════════════════════════════════
 * Make the ledger_entries payment idempotency guarantee reproducible.
 *
 * public.ledger_entries predates this repository's tracked migration history, so
 * the unique index its idempotency depends on has never been created by any
 * migration. Two places assert that index and neither creates it:
 *
 *   - database/ledgerEntries.ts upserts with onConflict: 'payment_id' and
 *     ignoreDuplicates: true, documenting "ON CONFLICT DO NOTHING enforced by
 *     the unique index in the DB".
 *   - 20260731163100_create_shift4_payment_attempts.sql preflights for a
 *     single-column UNIQUE index on ledger_entries (payment_id) and raises
 *     without it, because apply_shift4_attempt_evidence uses it as an
 *     ON CONFLICT target and would otherwise fail at the first confirmed
 *     payment with SQLSTATE 42P10.
 *
 * Until now the index existed only by convention, on whichever database happened
 * to have it. On an environment without it, a replayed confirmation posts a
 * SECOND financial row for one payment.
 *
 * This migration is forward-only and index-only. It reads no ledger row, writes
 * no ledger row, and deletes no ledger row. It never drops the primary key and
 * never references a merchant_id or created_at index.
 * ═════════════════════════════════════════════════════════════════════════════ */

/* ══ 1. Preflight: the table and column must exist ══════════════════════════ */
-- ledger_entries is not created by this repository, so its shape cannot be
-- verified from source. Fail explicitly rather than emitting a confusing
-- CREATE INDEX error.
do $table_preflight$
begin
  if to_regclass('public.ledger_entries') is null then
    raise exception
      'public.ledger_entries does not exist; refusing to create its payment idempotency index';
  end if;

  if not exists (
    select 1
      from pg_attribute
     where attrelid = 'public.ledger_entries'::regclass
       and attname = 'payment_id'
       and not attisdropped
       and attnum > 0
  ) then
    raise exception
      'public.ledger_entries has no payment_id column; refusing to create its payment idempotency index';
  end if;
end
$table_preflight$;

/* ══ 2. Preflight: abort on duplicate non-null payment_id ═══════════════════ */
-- Runs BEFORE any index DDL. A UNIQUE index permits many NULLs, so only
-- non-null duplicates can block it.
--
-- Duplicates are NOT deduplicated here. Two financial rows for one payment is an
-- accounting fact that needs an operator decision and an audit trail; a
-- migration must not silently delete or merge financial history to force an
-- index through. Report precisely and stop.
do $duplicate_preflight$
declare
  duplicate_payments bigint;
  duplicate_rows bigint;
  worst_offenders text;
begin
  select count(*), coalesce(sum(row_count), 0)
    into duplicate_payments, duplicate_rows
    from (
      select payment_id, count(*) as row_count
        from public.ledger_entries
       where payment_id is not null
       group by payment_id
      having count(*) > 1
    ) duplicates;

  if duplicate_payments > 0 then
    select string_agg(payment_id::text || ' (' || row_count || ' rows)', ', ')
      into worst_offenders
      from (
        select payment_id, count(*) as row_count
          from public.ledger_entries
         where payment_id is not null
         group by payment_id
        having count(*) > 1
         order by count(*) desc, payment_id
         limit 5
      ) worst;

    raise exception
      'Cannot enforce ledger_entries payment idempotency: % payment_id value(s) already have duplicate rows (% rows total). No index was changed and no ledger row was touched. Reconcile these first (worst offenders): %',
      duplicate_payments, duplicate_rows, worst_offenders;
  end if;
end
$duplicate_preflight$;

/* ══ 3. Canonical unique index ══════════════════════════════════════════════ */
-- ledger_entries_payment_id_on_conflict_idx is the canonical index. It supports:
--
--   * DUPLICATE-CONFIRMATION PROTECTION — a replayed provider webhook, or a
--     watcher running alongside a webhook, cannot post a second financial row
--     for the same payment.
--
--   * database/ledgerEntries.ts UPSERT WITH onConflict: "payment_id" —
--     upsertLedgerEntry passes { onConflict: 'payment_id', ignoreDuplicates:
--     true }, which compiles to ON CONFLICT (payment_id) DO NOTHING. Postgres
--     requires a unique index on exactly that column for the clause to be a
--     legal conflict target; without one the statement fails with 42P10.
--
--   * IDEMPOTENT FINANCIAL POSTING — engine/eventProcessor.ts writes the ledger
--     row after a confirmed transition, from both the webhook and the watcher
--     path, and relies on the first write winning rather than on call ordering.
--
-- IF NOT EXISTS matches by NAME, so this is a no-op where the canonical index is
-- already present, and additive where only a differently named unique index
-- exists. Built non-concurrently and inside the transaction so the migration
-- stays atomic; ledger_entries is small and this holds a brief ACCESS EXCLUSIVE
-- lock. Use a separate CONCURRENTLY build outside a transaction if the table has
-- grown large enough for that lock to matter.
create unique index if not exists ledger_entries_payment_id_on_conflict_idx
  on public.ledger_entries (payment_id);

comment on index public.ledger_entries_payment_id_on_conflict_idx is
  'Canonical ON CONFLICT target for public.ledger_entries.payment_id. Supports duplicate-confirmation protection, the database/ledgerEntries.ts upsert with onConflict: "payment_id", and idempotent financial posting. Do not drop.';

/* ══ 4. Confirm the canonical index before removing anything ════════════════ */
-- Same predicate shape the Shift4 attempts migration preflights on: unique,
-- single-column, on payment_id. If this does not hold, the transaction rolls
-- back and no redundant index is dropped.
do $confirm_canonical$
begin
  if not exists (
    select 1
      from pg_index idx
      join pg_class ind on ind.oid = idx.indexrelid
      join pg_class rel on rel.oid = idx.indrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'ledger_entries'
       and ind.relname = 'ledger_entries_payment_id_on_conflict_idx'
       and idx.indisunique
       and idx.indnatts = 1
       and idx.indkey[0] = (
         select attnum
           from pg_attribute
          where attrelid = rel.oid
            and attname = 'payment_id'
            and not attisdropped
       )
  ) then
    raise exception
      'ledger_entries_payment_id_on_conflict_idx is not a single-column UNIQUE index on payment_id; refusing to drop any redundant index';
  end if;
end
$confirm_canonical$;

/* ══ 5. Remove ONLY the two redundant standalone indexes ════════════════════ */
-- Refuse if either target name is constraint-backed. DROP INDEX cannot remove a
-- constraint's index, and dropping the constraint is a different, deliberate
-- decision this migration will not make on an operator's behalf.
--
-- This guard is also what protects the primary key: a primary key's index is a
-- constraint index (pg_constraint.conindid), so if either target name were ever
-- the primary key's index, the migration aborts here instead of dropping it.
do $redundant_guard$
declare
  blocking text;
begin
  select string_agg(c.conname || ' (backs index ' || idx.relname || ')', ', ')
    into blocking
    from pg_constraint c
    join pg_class idx on idx.oid = c.conindid
   where c.conrelid = 'public.ledger_entries'::regclass
     and idx.relname in (
       'ledger_entries_payment_id_unique_idx',
       'ledger_entries_payment_id_idx'
     );

  if blocking is not null then
    raise exception
      'Refusing to drop a constraint-backed index on public.ledger_entries: %. Drop the constraint deliberately instead.',
      blocking;
  end if;
end
$redundant_guard$;

-- Redundant once the canonical unique index above exists. Both are standalone
-- indexes on the same single column; neither carries information the canonical
-- index does not. Every other index on this table is left exactly as it is.
drop index if exists public.ledger_entries_payment_id_unique_idx;
drop index if exists public.ledger_entries_payment_id_idx;

/* ══ 6. Post-check: canonical index intact, redundant names gone ════════════ */
do $post_check$
begin
  if not exists (
    select 1
      from pg_index idx
      join pg_class ind on ind.oid = idx.indexrelid
      join pg_class rel on rel.oid = idx.indrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'ledger_entries'
       and ind.relname = 'ledger_entries_payment_id_on_conflict_idx'
       and idx.indisunique
       and idx.indnatts = 1
  ) then
    raise exception
      'ledger_entries_payment_id_on_conflict_idx is missing or no longer a single-column unique index after cleanup';
  end if;

  if to_regclass('public.ledger_entries_payment_id_unique_idx') is not null
     or to_regclass('public.ledger_entries_payment_id_idx') is not null then
    raise exception
      'A redundant ledger_entries payment_id index still exists after cleanup';
  end if;
end
$post_check$;

commit;
