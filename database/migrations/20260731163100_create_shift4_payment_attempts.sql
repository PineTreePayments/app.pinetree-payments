-- Durable, concurrency-safe storage for Shift4 REST payment attempts.
--
-- ── Why this table exists ────────────────────────────────────────────────────
-- The uncommitted Shift4 Phase 2 Engine stored attempts in
-- payments.metadata.shift4.attempts through a read-modify-write helper. That is
-- not production-safe: updatePaymentMetadata shallow-merges TOP-LEVEL keys, so
-- the whole `shift4` namespace is replaced by whichever writer commits last. A
-- live provider response and a reconciliation worker racing on one payment can
-- therefore erase an attempt that was already transmitted to Shift4 - a real,
-- possibly-approved transaction with no PineTree record - or revert a resolved
-- attempt back to unresolved after its ledger entry posted.
--
-- The Database, Identity, and Security Standard already names `payment_attempts`
-- as a canonical Payments-domain record, so an attempts table is the standard
-- shape rather than a Shift4 invention. This migration deliberately creates a
-- SHIFT4-SPECIFIC table instead of a generic provider_payment_attempts table:
-- Base, Solana, Speed, Stripe, and FluidPay are live and must not be forced into
-- a new storage contract during this work.
--
-- Forward-only and additive. No existing table, column, constraint, policy, or
-- row is modified. Shift4 Phase 2 is uncommitted and unwired, so there is no
-- production data to back-fill and no dual-write period.
--
-- ── What is deliberately NOT here ───────────────────────────────────────────
--   * The legacy ledger uniqueness model is untouched. Canonical sale/capture
--     and split-tender accounting uses the balanced journal installed by the
--     immediately preceding migration; ledger_entries remains a compatibility
--     projection with one row per fully confirmed payment.
--   * No new payments.status value. The canonical lifecycle stays at eight
--     states; an unknown Shift4 outcome lives in this table's recovery_state.
--   * No new payment_events.event_type value. Shift4 step names travel in
--     provider_event, which is free text.
--   * No card-on-file token storage. card_token_fingerprint is a
--     non-reversible SHA-256 prefix for correlation ONLY; it can never be
--     replayed to Shift4 and is not a substitute for the encrypted token
--     vault that card-on-file will require later.

begin;

/* ══ 0a. First-deployment preflight ═════════════════════════════════════════ */

-- This is a STRICT FIRST-DEPLOYMENT migration, not a schema-repair script.
--
-- It has never been executed. Every object below is created with a plain
-- CREATE, so a name that already exists raises duplicate_object and rolls the
-- whole transaction back. That is deliberate: `IF NOT EXISTS` and
-- `CREATE OR REPLACE` would silently accept an object whose definition differs
-- from this file, leaving the database in a state no one has reviewed. A clean
-- duplicate-object failure is far safer than silent schema drift.
--
-- This block reports the collision precisely, so an operator sees WHICH object
-- already exists instead of a bare duplicate-object error from whichever
-- statement happened to run first.
--
-- If this raises, do NOT edit the CREATE statements back to IF NOT EXISTS.
-- Inspect what is already installed and decide deliberately.
do $existing_objects$
declare
  found_objects text[] := array[]::text[];
  candidate text;
begin
  if to_regclass('public.shift4_payment_attempts') is not null then
    found_objects := found_objects || 'table public.shift4_payment_attempts';
  end if;

  if to_regclass('public.shift4_tender_groups') is not null then
    found_objects := found_objects || 'table public.shift4_tender_groups';
  end if;

  /* Functions, matched by name in the public schema regardless of signature. */
  foreach candidate in array array[
    'create_shift4_payment_attempt',
    'claim_due_shift4_payment_attempts',
    'apply_shift4_attempt_evidence',
    'release_shift4_attempt_lease',
    'shift4_canonical_status_path',
    'shift4_status_event_type',
    'shift4_tender_group_identity_is_immutable'
  ] loop
    if exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = candidate
    ) then
      found_objects := found_objects || ('function public.' || candidate);
    end if;
  end loop;

  /* Indexes and constraints this migration creates by name. */
  foreach candidate in array array[
    'shift4_payment_attempts_merchant_attempt_uidx',
    'shift4_payment_attempts_connection_invoice_role_uidx',
    'shift4_payment_attempts_connection_chain_invoice_uidx',
    'shift4_payment_attempts_connection_operation_idem_uidx',
    'shift4_payment_attempts_payment_idx',
    'shift4_payment_attempts_merchant_created_idx',
    'shift4_payment_attempts_connection_created_idx',
    'shift4_payment_attempts_authorization_idx',
    'shift4_payment_attempts_recovery_state_idx',
    'shift4_payment_attempts_due_work_idx',
    'shift4_payment_attempts_active_lease_idx',
    'shift4_payment_attempts_related_idx',
    'shift4_payment_attempts_chain_root_uidx',
    'shift4_payment_attempts_chain_idx',
    'shift4_payment_attempts_tender_idx',
    'shift4_tender_groups_payment_connection_uidx',
    'shift4_tender_groups_merchant_idx'
  ] loop
    if to_regclass('public.' || candidate) is not null then
      found_objects := found_objects || ('index public.' || candidate);
    end if;
  end loop;

  if exists (
    select 1 from pg_constraint
     where conname like 'shift4_payment_attempts%'
  ) then
    found_objects := found_objects || 'one or more shift4_payment_attempts constraints';
  end if;

  if array_length(found_objects, 1) is not null then
    raise exception
      'Shift4 attempts migration is a first-deployment migration, but these objects already exist: %. Inspect the installed schema and decide deliberately; do not weaken the CREATE statements.',
      array_to_string(found_objects, ', ');
  end if;
end
$existing_objects$;

/* ══ 0b. Dependency preflight ═══════════════════════════════════════════════ */

-- Built-ins, extension-provided functions, and roles this migration needs.
-- Checked before anything is created so a missing dependency fails cleanly
-- rather than part-way through deployment.
--
-- No extension is installed here. Installing pgcrypto (or any extension) is a
-- separate, deliberate operator decision.
do $dependencies$
declare
  v_major integer;
begin
  /* gen_random_uuid(): pgcrypto in older servers, core since PostgreSQL 13. */
  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception
      'Shift4 attempts migration requires gen_random_uuid(). It is built in from PostgreSQL 13 and provided by the pgcrypto extension before that. Install or enable it first; this migration deliberately does not create extensions.';
  end if;

  -- Checked through pg_proc rather than to_regprocedure. A regprocedure cast
  -- must parse its argument list, and the documentation display form of a
  -- variadic or pseudo-type signature is not guaranteed to be accepted as
  -- regprocedure input - a cast failure would raise the WRONG error, blaming a
  -- missing function when the real problem was the lookup string.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pg_catalog' and p.proname = 'jsonb_build_object'
  ) then
    raise exception 'Shift4 attempts migration requires jsonb_build_object()';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name in ('id', 'merchant_id') and data_type <> 'uuid'
  ) then
    raise exception 'Shift4 attempts migration requires payments.id and payments.merchant_id to be uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'gross_amount' and data_type = 'numeric'
  ) then
    raise exception 'Shift4 attempts migration requires payments.gross_amount to be numeric/decimal';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'currency'
       and data_type in ('text', 'character varying', 'character')
  ) then
    raise exception 'Shift4 attempts migration requires payments.currency to be text-compatible';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'merchant_providers'
       and column_name in ('id', 'merchant_id') and data_type <> 'uuid'
  ) then
    raise exception 'Shift4 attempts migration requires merchant_providers.id and merchant_providers.merchant_id to be uuid';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pg_catalog' and p.proname = 'make_interval'
  ) then
    raise exception 'Shift4 attempts migration requires make_interval()';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pg_catalog' and p.proname = 'jsonb_build_object'
       and p.provariadic <> 0
  ) then
    raise exception
      'Shift4 attempts migration requires the variadic form of jsonb_build_object()';
  end if;

  /* FOR UPDATE SKIP LOCKED underpins claim_due_shift4_payment_attempts.
     Available from PostgreSQL 9.5; assert explicitly rather than assume. */
  select (current_setting('server_version_num')::integer / 10000) into v_major;
  if v_major < 10 then
    raise exception
      'Shift4 attempts migration requires PostgreSQL 10 or newer for FOR UPDATE SKIP LOCKED and the catalog columns used here; server reports major version %',
      v_major;
  end if;

  /* Roles referenced by the REVOKE/GRANT block at the end of this file. */
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Shift4 attempts migration requires the service_role role';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'Shift4 attempts migration requires the anon role to revoke from';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'Shift4 attempts migration requires the authenticated role to revoke from';
  end if;
end
$dependencies$;

/* ══ 0c. External schema preflight ══════════════════════════════════════════ */

-- Everything below depends on tables this repository does NOT create: payments,
-- payment_events, ledger_entries, and merchant_providers all predate the tracked
-- migration history, so their exact shape cannot be verified from source.
--
-- The `on conflict (payment_id)` in apply_shift4_attempt_evidence is the sharpest
-- case. A PL/pgSQL body is only syntax-checked at CREATE FUNCTION time, never
-- planned, so a MISSING unique index on ledger_entries.payment_id would let this
-- whole migration commit cleanly and then fail at the FIRST confirmed Shift4
-- payment with SQLSTATE 42P10. That is the worst possible place to discover it.
--
-- This block turns that latent runtime failure into an immediate, explicit
-- migration failure. Everything is inside the transaction, so a raise here rolls
-- back with nothing deployed.
do $preflight$
declare
  missing text;
begin
  /* Required tables. The journal foundation migration must run FIRST: capture
     postings go through post_ledger_transaction, not the legacy ledger. */
  foreach missing in array array[
    'public.payments', 'public.payment_events',
    'public.ledger_entries', 'public.merchant_providers',
    'public.ledger_accounts', 'public.ledger_transactions',
    'public.ledger_journal_entries', 'public.ledger_links'
  ] loop
    if to_regclass(missing) is null then
      raise exception
        'Shift4 attempts migration requires table %, which does not exist', missing;
    end if;
  end loop;

  /* The generic journal posting helpers must already exist. Capture postings go
     through post_ledger_transaction, not the legacy flat ledger. */
  if to_regprocedure(
    'public.post_ledger_transaction(text,text,text,text,uuid,text,jsonb,jsonb,text,date,timestamptz,text,text,uuid,text,integer)'
  ) is null then
    raise exception
      'Shift4 attempts migration requires public.post_ledger_transaction(); apply 20260731163000_create_ledger_journal_foundation.sql first';
  end if;

  if to_regprocedure(
    'public.resolve_ledger_account(text,text,text,text,text,text,integer)'
  ) is null then
    raise exception
      'Shift4 attempts migration requires public.resolve_ledger_account(); apply 20260731163000_create_ledger_journal_foundation.sql first';
  end if;

  if exists (
    select 1
      from (values ('anon'), ('authenticated'), ('service_role')) roles(name)
     where has_function_privilege(
       roles.name,
       'public.post_ledger_transaction(text,text,text,text,uuid,text,jsonb,jsonb,text,date,timestamptz,text,text,uuid,text,integer)',
       'EXECUTE'
     )
        or has_function_privilege(
          roles.name,
          'public.resolve_ledger_account(text,text,text,text,text,text,integer)',
          'EXECUTE'
        )
  ) then
    raise exception
      'Shift4 attempts migration requires journal helpers to remain private to their owner; PUBLIC and application roles must not have EXECUTE';
  end if;

  if exists (
    select 1
      from pg_proc p
     where p.oid in (
       'public.post_ledger_transaction(text,text,text,text,uuid,text,jsonb,jsonb,text,date,timestamptz,text,text,uuid,text,integer)'::regprocedure,
       'public.resolve_ledger_account(text,text,text,text,text,text,integer)'::regprocedure
     )
       and exists (
         select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl::text like '=%X%'
       )
  ) then
    raise exception
      'Shift4 attempts migration requires PUBLIC to have no EXECUTE privilege on journal helpers';
  end if;

  /* Columns this migration reads or writes on those tables. */
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name in ('id','merchant_id','status','gross_amount','currency',
                           'provider','network','payment_url','updated_at')
     group by table_name having count(distinct column_name) = 9
  ) then
    raise exception
      'Shift4 attempts migration requires payments columns id, merchant_id, status, gross_amount, currency, provider, network, payment_url, updated_at';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'merchant_providers'
       and column_name in ('id','merchant_id','provider')
     group by table_name having count(distinct column_name) = 3
  ) then
    raise exception
      'Shift4 attempts migration requires merchant_providers columns id, merchant_id, provider';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_events'
       and column_name in ('id','payment_id','event_type','provider_event','raw_payload')
     group by table_name having count(distinct column_name) = 5
  ) then
    raise exception
      'Shift4 attempts migration requires payment_events columns id, payment_id, event_type, provider_event, raw_payload';
  end if;

  /* The ON CONFLICT target. Must be a UNIQUE index on exactly (payment_id). */
  if not exists (
    select 1
      from pg_index idx
      join pg_class rel on rel.oid = idx.indrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'ledger_entries'
       and idx.indisunique
       and idx.indnatts = 1
       and idx.indkey[0] = (
         select attnum from pg_attribute
          where attrelid = rel.oid and attname = 'payment_id' and not attisdropped
       )
  ) then
    raise exception
      'Shift4 attempts migration requires a UNIQUE index on ledger_entries (payment_id); apply_shift4_attempt_evidence uses it as its ON CONFLICT target and would fail at the first confirmed payment without it';
  end if;

  /* ── Every ledger_entries column apply_shift4_attempt_evidence writes ───── */
  -- The insert names ten columns. A missing one, or one whose type cannot
  -- accept the value, would fail at the first confirmed payment rather than
  -- here. Types are checked as CATEGORIES so a reasonable variant (text vs
  -- varchar, numeric vs bigint) passes while a genuinely wrong type fails.
  for missing in
    select column_name from (values
      ('merchant_id'), ('payment_id'), ('provider'), ('network'), ('asset'),
      ('amount'), ('usd_value'), ('wallet_address'), ('direction'), ('status')
    ) as required(column_name)
     where not exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'ledger_entries'
          and c.column_name = required.column_name
     )
  loop
    raise exception
      'Shift4 attempts migration requires ledger_entries column %, which does not exist', missing;
  end loop;

  /* Money columns must be numeric; identifiers must be uuid or text-like. */
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ledger_entries'
       and column_name in ('amount', 'usd_value')
       and data_type not in ('numeric', 'bigint', 'integer', 'double precision', 'real')
  ) then
    raise exception
      'Shift4 attempts migration requires ledger_entries.amount and usd_value to be numeric types';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ledger_entries'
       and column_name in ('provider', 'network', 'asset', 'wallet_address', 'direction', 'status')
       and data_type not in ('text', 'character varying', 'character')
  ) then
    raise exception
      'Shift4 attempts migration requires ledger_entries provider, network, asset, wallet_address, direction, and status to be text types';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ledger_entries'
       and column_name in ('merchant_id', 'payment_id')
       and data_type not in ('uuid', 'text', 'character varying')
  ) then
    raise exception
      'Shift4 attempts migration requires ledger_entries.merchant_id and payment_id to be uuid or text';
  end if;

  /* `id` is not supplied by the insert, so it must be generated or nullable. */
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ledger_entries'
       and column_name = 'id'
       and is_nullable = 'NO'
       and column_default is null
       and is_identity = 'NO'
  ) then
    raise exception
      'Shift4 attempts migration requires ledger_entries.id to have a default or be an identity column; the ledger insert does not supply it';
  end if;

  /* ── payment_events column types ────────────────────────────────────────── */
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_events'
       and column_name = 'raw_payload'
       and data_type not in ('jsonb', 'json')
  ) then
    raise exception 'Shift4 attempts migration requires payment_events.raw_payload to be jsonb';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_events'
       and column_name in ('event_type', 'provider_event')
       and data_type not in ('text', 'character varying', 'character')
  ) then
    raise exception
      'Shift4 attempts migration requires payment_events.event_type and provider_event to be text types';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_events'
       and column_name in ('id', 'payment_id')
       and data_type not in ('uuid', 'text', 'character varying')
  ) then
    raise exception
      'Shift4 attempts migration requires payment_events.id and payment_id to be uuid or text';
  end if;

  /* ── Every event_type this migration can insert must be accepted ─────────
   * Checked against ALL check constraints on the table that mention
   * 'payment.', not one hardcoded constraint name: the accepted set has been
   * rewritten by more than one past migration, and a differently-named
   * constraint would otherwise be missed entirely.
   */
  for missing in
    select event_type from (values
      ('payment.reconciled'), ('payment.pending'), ('payment.processing'),
      ('payment.confirmed'), ('payment.failed'), ('payment.canceled'),
      ('payment.expired'), ('payment.incomplete')
    ) as required(event_type)
     where exists (
       select 1 from pg_constraint
        where conrelid = 'public.payment_events'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) like '%payment.%'
          and pg_get_constraintdef(oid) not like ('%' || required.event_type || '%')
     )
  loop
    raise exception
      'Shift4 attempts migration requires payment_events.event_type to accept %; a CHECK constraint on that table rejects it', missing;
  end loop;
end
$preflight$;

/* ══ 1. Table ═══════════════════════════════════════════════════════════════ */

/* ── Tender group ──────────────────────────────────────────────────────────
 * The authoritative requested total for a PineTree payment on one Shift4
 * provider connection, in integer minor units.
 *
 * public.payments has no minor-unit column - merchant_amount, pinetree_fee, and
 * gross_amount are all major-unit numerics. The amount is converted exactly
 * once from the locked NUMERIC gross_amount by create_shift4_payment_attempt,
 * which rejects fractional minor units, and is stored here immutably.
 *
 * The group row is also the tender-sequence allocator: it is locked FOR UPDATE
 * before a sequence is assigned, which removes the MAX(tender_sequence) race.
 */
create table public.shift4_tender_groups (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  payment_id uuid not null
    constraint shift4_tender_groups_payment_fk
    references public.payments (id) on delete restrict,
  merchant_provider_connection_id uuid not null
    constraint shift4_tender_groups_connection_fk
    references public.merchant_providers (id) on delete restrict,

  currency varchar(3) not null,
  /* Set once at creation. No caller may change it afterwards - the immutability
     trigger below refuses, so a later tender cannot move the goalposts. */
  requested_amount_minor bigint not null,

  next_tender_sequence integer not null default 1,
  state text not null default 'open',
  version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift4_tender_groups_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint shift4_tender_groups_requested_amount_check
    check (requested_amount_minor > 0),
  constraint shift4_tender_groups_next_sequence_check
    check (next_tender_sequence >= 1),
  constraint shift4_tender_groups_state_check
    check (state in ('open', 'settled', 'closed', 'reconciliation_required'))
);

-- One group per PineTree payment per Shift4 provider connection.
create unique index shift4_tender_groups_payment_connection_uidx
  on public.shift4_tender_groups (payment_id, merchant_provider_connection_id);

create index shift4_tender_groups_merchant_idx
  on public.shift4_tender_groups (merchant_id, created_at desc);

comment on table public.shift4_tender_groups is
  'Authoritative integer minor-unit requested total for one PineTree payment on one Shift4 connection, plus the tender-sequence allocator. Derived once from locked payments.gross_amount; never supplied by an application caller.';

-- The requested amount and ownership are financial identity: immutable.
create function public.shift4_tender_group_identity_is_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.requested_amount_minor <> old.requested_amount_minor
     or new.payment_id <> old.payment_id
     or new.merchant_id <> old.merchant_id
     or new.merchant_provider_connection_id <> old.merchant_provider_connection_id
     or new.currency <> old.currency then
    raise exception
      'Shift4 tender group identity is immutable; requested amount and ownership cannot be changed after creation';
  end if;
  return new;
end
$function$;

create trigger shift4_tender_groups_identity_immutable
  before update on public.shift4_tender_groups
  for each row execute function public.shift4_tender_group_identity_is_immutable();

-- A tender group is the authoritative requested total for real money. Deleting
-- one would orphan its attempts' financial context, so deletion is refused
-- outright rather than left to privilege alone.
create function public.shift4_tender_group_is_undeletable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception
    'Shift4 tender groups are not deletable: they carry the authoritative requested total for a payment.';
end
$function$;

create trigger shift4_tender_groups_undeletable
  before delete on public.shift4_tender_groups
  for each row execute function public.shift4_tender_group_is_undeletable();

/* ── Tender-group access ───────────────────────────────────────────────────
 * Same total lockdown as the attempts table: RLS on, NO policy, everything
 * revoked including service_role. Every write happens inside a SECURITY
 * DEFINER function, and no TypeScript path reads this table directly, so it
 * receives no table grant at all - not even SELECT.
 */
alter table public.shift4_tender_groups enable row level security;

revoke all on public.shift4_tender_groups from public;
revoke all on public.shift4_tender_groups from anon;
revoke all on public.shift4_tender_groups from authenticated;
revoke all on public.shift4_tender_groups from service_role;

-- Plain CREATE TABLE: a pre-existing table must fail, not be silently accepted.
create table public.shift4_payment_attempts (
  /* Identity */
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null,
  merchant_id uuid not null,

  /* ── Referential integrity ────────────────────────────────────────────────
   * ON DELETE RESTRICT, not CASCADE, on both parents.
   *
   * A Shift4 attempt is financial evidence: it records that PineTree
   * transmitted a transaction to a card processor and what came back.
   * Cascading would let a parent row's deletion silently destroy the proof of
   * a money movement. Nothing in this repository deletes a payment or a
   * provider connection, so RESTRICT is inert in normal operation and only
   * bites when someone attempts a deletion that should have been a deliberate,
   * audited decision.
   */
  payment_id uuid not null
    constraint shift4_payment_attempts_payment_fk
    references public.payments (id) on delete restrict,
  merchant_provider_connection_id uuid not null
    constraint shift4_payment_attempts_connection_fk
    references public.merchant_providers (id) on delete restrict,
  /* The Shift4 REST endpoint invoked. Several PineTree steps share one
     endpoint - a referral authorization and the manual (voice) authorization
     that resolves it are both POST /transactions/authorization - so
     `operation` alone cannot identify a step. `attempt_role` does. */
  operation text not null,
  channel text not null,
  attempt_number integer not null default 1,

  /* ── Transaction chain ────────────────────────────────────────────────────
   * Shift4 links a transaction CHAIN by invoice. One chain owns one invoice on
   * one provider connection, and several legitimate steps live inside it:
   *
   *   authorization -> referral -> manual authorization -> capture -> void
   *
   * The earlier model scoped invoice uniqueness by `operation`, which rejected
   * the certification-required manual authorization outright: retail test 7
   * reuses the referral's invoice, and both calls are the authorization
   * endpoint, so both rows carried operation = 'authorization'.
   *
   *   chain_id          groups every attempt in one Shift4 transaction chain
   *   root_attempt_id   the attempt that established the chain and its invoice
   *   related_attempt_id the direct parent step this attempt acts on
   *   attempt_role      the PineTree/Shift4 step, independent of the endpoint
   */
  chain_id uuid not null,
  root_attempt_id text not null,
  related_attempt_id text,
  attempt_role text not null,
  authorization_attempt_id text,
  refund_id text,

  /* ── Tender ───────────────────────────────────────────────────────────────
   * A payment may be satisfied by several tenders (partial approval, split
   * tender). Each tender is its own chain with its own invoice, and every
   * tender-bearing attempt carries the group that owns the authoritative
   * requested total, so the lineage is stored rather than re-derived.
   *
   * Nullable, with a CHECK below, because a refund establishes its own chain
   * and is NOT a tender of the payment. Making the column unconditionally NOT
   * NULL would have forced a meaningless tender group onto every refund.
   *
   * ON DELETE RESTRICT: an attempt's financial context must not be removable.
   */
  tender_group_id uuid
    constraint shift4_payment_attempts_tender_group_fk
    references public.shift4_tender_groups (id) on delete restrict,
  tender_sequence integer not null default 1,
  /** Requested minus approved on a partial approval. Null when not partial. */
  remaining_amount_minor bigint,

  /* ── Voice authorization ──────────────────────────────────────────────────
   * Returned with a referral response so a clerk can telephone for approval.
   * Both are non-secret operational contact details. No call recording, PAN,
   * CVV, PIN, or track data is stored anywhere in this table.
   */
  voice_center_account_number text,
  voice_center_phone_number text,
  /** The code a clerk obtained by voice and supplied to manual authorization. */
  manual_authorization_code text,

  /* Request identity. The idempotency key is stored ONLY as a hash. */
  idempotency_key_hash text not null,
  request_fingerprint text not null,
  correlation_id text not null,
  invoice varchar(10) not null,

  /* Money. Integer minor units only - never floating point, never numeric(_,2). */
  amount_minor bigint not null,
  approved_amount_minor bigint,
  authorized_amount_minor bigint,
  currency varchar(3) not null,

  /* Attempt state */
  state text not null,
  recovery_state text not null default 'none',
  timeout_classification text,
  resolution_reason text,
  lookup_attempt_count integer not null default 0,
  resend_count integer not null default 0,
  version integer not null default 1,

  /* Provider evidence. All non-secret. */
  response_code text,
  primary_code integer,
  secondary_code integer,
  authorization_code text,
  retrieval_reference text,
  sale_flag text,
  card_on_file_transaction_id text,
  avs_result text,
  csc_result text,
  entry_mode text,
  entry_channel text,
  card_token_fingerprint text,
  raw_response_ref text,
  evidence_source text,

  /* Timestamps. Provider occurred_at and PineTree received_at are both kept. */
  request_started_at timestamptz not null default now(),
  request_dispatched_at timestamptz,
  provider_occurred_at timestamptz,
  received_at timestamptz,
  first_unknown_at timestamptz,
  next_check_at timestamptz,
  last_lookup_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* Bounded recovery lease. Prevents two workers claiming one attempt. */
  lease_owner text,
  lease_expires_at timestamptz,

  /* ── Controlled vocabularies ───────────────────────────────────────────── */
  constraint shift4_payment_attempts_operation_check
    check (operation in ('sale', 'authorization', 'capture', 'refund', 'void')),

  constraint shift4_payment_attempts_channel_check
    check (channel in ('retail', 'ecommerce')),

  /* Roles. sale / authorization / manual_authorization / capture / void /
     refund are REQUEST roles chosen at creation. referral_authorization and
     partial_authorization are RESOLVED roles: Shift4's response decides them,
     so the evidence function promotes an attempt into one. */
  constraint shift4_payment_attempts_attempt_role_check
    check (attempt_role in (
      'sale', 'authorization', 'referral_authorization', 'manual_authorization',
      'partial_authorization', 'capture', 'void', 'refund'
    )),

  /* The role must be reachable through the endpoint that was invoked. */
  constraint shift4_payment_attempts_role_matches_operation_check
    check (
      (operation = 'sale' and attempt_role = 'sale')
      or (operation = 'authorization' and attempt_role in (
            'authorization', 'referral_authorization',
            'manual_authorization', 'partial_authorization'))
      or (operation = 'capture' and attempt_role = 'capture')
      or (operation = 'void' and attempt_role = 'void')
      or (operation = 'refund' and attempt_role = 'refund')
    ),

  /* A chain root points at itself and has no parent; every other attempt has
     one. This is what makes "one chain owns one invoice" expressible. */
  constraint shift4_payment_attempts_chain_root_check
    check (
      (root_attempt_id = attempt_id and related_attempt_id is null)
      or (root_attempt_id <> attempt_id and related_attempt_id is not null)
    ),

  constraint shift4_payment_attempts_tender_sequence_check
    check (tender_sequence >= 1),

  /* Every attempt that participates in the payment's tender total must name the
     group that owns that total. Only a refund - its own chain, not a tender -
     may omit it. */
  constraint shift4_payment_attempts_tender_group_required_check
    check (attempt_role = 'refund' or tender_group_id is not null),

  constraint shift4_payment_attempts_remaining_amount_check
    check (remaining_amount_minor is null or remaining_amount_minor >= 0),

  /* A partial approval must state exactly how much is still outstanding. */
  constraint shift4_payment_attempts_partial_remainder_check
    check (
      attempt_role <> 'partial_authorization'
      or (
        approved_amount_minor is not null
        and remaining_amount_minor is not null
        and approved_amount_minor < amount_minor
        and approved_amount_minor + remaining_amount_minor = amount_minor
      )
    ),

  /* A manual authorization is only meaningful with the code obtained by voice. */
  constraint shift4_payment_attempts_manual_code_check
    check (
      attempt_role <> 'manual_authorization'
      or (manual_authorization_code is not null
          and length(btrim(manual_authorization_code)) > 0)
    ),

  constraint shift4_payment_attempts_state_check
    check (state in (
      'created', 'dispatched', 'approved', 'declined', 'unresolved',
      'action_required', 'reconciliation_required', 'abandoned'
    )),

  constraint shift4_payment_attempts_recovery_state_check
    check (recovery_state in ('none', 'pending_lookup', 'resolved', 'exhausted', 'blocked')),

  constraint shift4_payment_attempts_timeout_classification_check
    check (
      timeout_classification is null
      or timeout_classification in ('timeout', 'communication_failure', 'invalid_response')
    ),

  /* Currency is a normalized three-letter uppercase code. */
  constraint shift4_payment_attempts_currency_check
    check (currency ~ '^[A-Z]{3}$'),

  /* Shift4 invoices are exactly ten decimal digits. */
  constraint shift4_payment_attempts_invoice_check
    check (invoice ~ '^[0-9]{10}$'),

  /* Money is nonnegative integer minor units. */
  constraint shift4_payment_attempts_amount_minor_check
    check (amount_minor >= 0),
  constraint shift4_payment_attempts_approved_amount_minor_check
    check (approved_amount_minor is null or approved_amount_minor >= 0),
  constraint shift4_payment_attempts_authorized_amount_minor_check
    check (authorized_amount_minor is null or authorized_amount_minor >= 0),

  /* Counters */
  constraint shift4_payment_attempts_lookup_attempt_count_check
    check (lookup_attempt_count >= 0),
  constraint shift4_payment_attempts_resend_count_check
    check (resend_count >= 0),
  constraint shift4_payment_attempts_attempt_number_check
    check (attempt_number >= 1),
  constraint shift4_payment_attempts_version_check
    check (version >= 1),

  /* A capture must name the authorization it closes; a void must name the
     transaction it reverses; a refund must be distinguishable from every other
     refund of the same payment. */
  constraint shift4_payment_attempts_capture_requires_authorization_check
    check (operation <> 'capture' or authorization_attempt_id is not null),
  constraint shift4_payment_attempts_void_requires_related_check
    check (operation <> 'void' or related_attempt_id is not null),
  constraint shift4_payment_attempts_refund_requires_refund_id_check
    check (operation <> 'refund' or refund_id is not null),

  /* The capture-specific alias must agree with the generic lineage pointer. */
  constraint shift4_payment_attempts_capture_lineage_alias_check
    check (
      operation <> 'capture'
      or related_attempt_id is not distinct from authorization_attempt_id
    ),

  /* Superseded by shift4_payment_attempts_chain_root_check. An operation-based
     rule would have forbidden the manual authorization that certification
     requires, because it uses the authorization endpoint AND has a parent. */

  /* FULL CAPTURE ONLY.
     Partial capture is not approved by PineTree or certified with Shift4, and
     the retail and e-commerce scripts both require amount.total to equal the
     authorization amount. A capture must therefore carry a known authorized
     amount and match it exactly - not merely stay under it. */
  constraint shift4_payment_attempts_capture_equals_authorization_check
    check (
      operation <> 'capture'
      or (authorized_amount_minor is not null and amount_minor = authorized_amount_minor)
    ),

  /* A lease is either fully present or fully absent. */
  constraint shift4_payment_attempts_lease_pairing_check
    check ((lease_owner is null) = (lease_expires_at is null))
);

comment on table public.shift4_payment_attempts is
  'Durable Shift4 REST payment attempts. Replaces payments.metadata.shift4.attempts, which was concurrency-unsafe. Service-role and SECURITY DEFINER access only. Never stores an auth token, access token, client GUID, raw card token, PAN, CVV/CSC input, track data, PIN data, unredacted payload, or plaintext idempotency key.';

comment on column public.shift4_payment_attempts.response_code is
  'Shift4 host response code exactly as received. Deliberately unconstrained text: an undocumented future code must stay persistable and recoverable rather than being rejected or silently coerced.';

comment on column public.shift4_payment_attempts.card_token_fingerprint is
  'Non-reversible SHA-256 prefix of the Shift4 token, for correlation only. Not a card-on-file token and not replayable to Shift4.';

comment on column public.shift4_payment_attempts.idempotency_key_hash is
  'SHA-256 of the PineTree idempotency key. The plaintext key is never stored.';

comment on column public.shift4_payment_attempts.amount_minor is
  'Integer minor currency units, per the Financial Ledger, Money, and Reconciliation Standard. Floating point is never authoritative for money.';

/* ══ 2. Uniqueness ══════════════════════════════════════════════════════════ */

-- One PineTree attempt identity per merchant.
create unique index shift4_payment_attempts_merchant_attempt_uidx
  on public.shift4_payment_attempts (merchant_id, attempt_id);

-- Invoice identity is scoped to the provider connection AND the operation.
--
-- Scoping by connection alone was wrong and would have broken every capture and
-- every void. Shift4 links a transaction CHAIN by invoice: a capture settles its
-- authorization under the same invoice, and a void reverses its originating
-- transaction under that transaction's invoice. A (connection, invoice) unique
-- index rejects exactly the rows Shift4 requires to exist.
--
-- Including `operation` keeps every duplicate that actually matters impossible
-- while permitting the chains that are correct:
--
--   rejected   two sales on one invoice          (connection, invoice, 'sale')
--   rejected   two authorizations on one invoice (connection, invoice, 'authorization')
--   rejected   two captures of one authorization (connection, invoice, 'capture')
--   rejected   two voids of one transaction      (connection, invoice, 'void')
--   allowed    authorization + its capture       different operation
--   allowed    originating transaction + its void  different operation
--
-- A refund must NOT reuse an originating invoice at all; that is enforced in
-- create_shift4_payment_attempt, because it is a cross-row rule an index cannot
-- express. Lineage (which chain an attempt may join) is likewise enforced in the
-- function. This index is the duplicate guard, not the whole invoice model.
--
-- This shape also leaves the documented manual/voice-authorization flow possible
-- later: it reuses the ORIGINAL authorization's invoice under a different
-- operation, which this index permits.
-- One row per ROLE per invoice, not per operation.
--
-- Scoping by `operation` rejected the manual authorization that retail
-- certification test 7 requires: a referral authorization and the manual
-- authorization that resolves it both use POST /transactions/authorization, so
-- both rows carry operation = 'authorization' on the same invoice. Roles
-- distinguish them, so both may exist while a duplicate of either cannot.
create unique index shift4_payment_attempts_connection_invoice_role_uidx
  on public.shift4_payment_attempts (merchant_provider_connection_id, invoice, attempt_role);

-- EXACTLY ONE CHAIN OWNS AN INVOICE on a provider connection.
--
-- This is the authoritative invoice rule. A chain root points at itself
-- (root_attempt_id = attempt_id), so indexing only roots means one invoice can
-- be established once per MID, while every legitimate step INSIDE that chain -
-- referral, manual authorization, capture, void - reuses it freely.
--
-- The predicate compares two columns of the same row, which is immutable and
-- valid in a partial index. A read-before-insert check in the function is a
-- convenience for a clear error message; it cannot be the protection, because
-- two concurrent inserts can both pass it.
create unique index shift4_payment_attempts_connection_chain_invoice_uidx
  on public.shift4_payment_attempts (merchant_provider_connection_id, invoice)
  where root_attempt_id = attempt_id;

-- One chain identity, and one root per chain.
create unique index shift4_payment_attempts_chain_root_uidx
  on public.shift4_payment_attempts (chain_id)
  where root_attempt_id = attempt_id;

create index shift4_payment_attempts_chain_idx
  on public.shift4_payment_attempts (chain_id, created_at asc);

-- Tender aggregation for a payment: split tender and partial approval both
-- need every tender on one payment, cheaply and in a stable order.
create index shift4_payment_attempts_tender_idx
  on public.shift4_payment_attempts (payment_id, tender_sequence, created_at asc);

-- Tender-group aggregation: sum approved/captured amounts for one group without
-- scanning the payment's unrelated chains.
create index shift4_payment_attempts_tender_group_idx
  on public.shift4_payment_attempts (tender_group_id, attempt_role, state)
  where tender_group_id is not null;

-- One logical operation identity per connection, so a replayed idempotency key
-- resolves to the existing attempt instead of sending a second transaction.
create unique index shift4_payment_attempts_connection_operation_idem_uidx
  on public.shift4_payment_attempts (
    merchant_provider_connection_id, operation, idempotency_key_hash
  );

/* ══ 3. Indexes ═════════════════════════════════════════════════════════════ */

create index shift4_payment_attempts_payment_idx
  on public.shift4_payment_attempts (payment_id);

create index shift4_payment_attempts_merchant_created_idx
  on public.shift4_payment_attempts (merchant_id, created_at desc);

create index shift4_payment_attempts_connection_created_idx
  on public.shift4_payment_attempts (merchant_provider_connection_id, created_at desc);

create index shift4_payment_attempts_authorization_idx
  on public.shift4_payment_attempts (authorization_attempt_id)
  where authorization_attempt_id is not null;

-- Lineage lookups: find every attempt that joined a given transaction chain.
create index shift4_payment_attempts_related_idx
  on public.shift4_payment_attempts (related_attempt_id)
  where related_attempt_id is not null;

create index shift4_payment_attempts_recovery_state_idx
  on public.shift4_payment_attempts (recovery_state, next_check_at);

-- The due-work index. Ordering matches claim_due_shift4_payment_attempts
-- exactly (next_check_at, created_at, id) so the queue is deterministic and the
-- oldest unresolved attempt can never be starved by newer work.
create index shift4_payment_attempts_due_work_idx
  on public.shift4_payment_attempts (next_check_at asc, created_at asc, id asc)
  where recovery_state = 'pending_lookup' and next_check_at is not null;

-- Lets an operator or sweep find leases that need expiring without scanning.
create index shift4_payment_attempts_active_lease_idx
  on public.shift4_payment_attempts (lease_expires_at)
  where lease_expires_at is not null;

/* ══ 4. Row-level security ══════════════════════════════════════════════════ */

alter table public.shift4_payment_attempts enable row level security;

-- Total lockdown, matching merchant_providers, merchant_speed_credentials, and
-- merchant_withdrawal_destinations: RLS is enabled and NO policy is created, so
-- anon and authenticated can neither read nor write. Every access path goes
-- through service-role backend code (database/shift4PaymentAttempts.ts) or the
-- SECURITY DEFINER functions below, each of which re-verifies tenancy itself.
--
-- This is stricter than a merchant-membership read policy and satisfies the
-- Database, Identity, and Security Standard's prohibition on merchant_id =
-- auth.uid() by never relying on that equivalence at all. A merchant-facing
-- read projection, when one is needed, must arrive as its own reviewed policy
-- built on explicit membership - not by loosening this table.
revoke all on public.shift4_payment_attempts from public;
revoke all on public.shift4_payment_attempts from anon;
revoke all on public.shift4_payment_attempts from authenticated;

-- service_role is revoked too, then granted back exactly what it needs in the
-- privileges section. Supabase projects commonly carry ALTER DEFAULT PRIVILEGES
-- that hand service_role full rights on every new table in `public`, so
-- granting SELECT without revoking first would leave INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, and TRIGGER quietly in place.
revoke all on public.shift4_payment_attempts from service_role;

/* ══ 5. Internal helpers ════════════════════════════════════════════════════ */

-- Canonical PineTree lifecycle path from one status to another.
--
-- Returns the ordered intermediate statuses required to reach `target`, or NULL
-- when the transition is not legal. Encodes the Lifecycle and Merchant Status
-- Standard exactly, mirroring engine/paymentStateMachine.ts:
--     CREATED    -> PENDING, CANCELED
--     PENDING    -> PROCESSING, EXPIRED, CANCELED, INCOMPLETE
--     PROCESSING -> CONFIRMED, FAILED
--     CONFIRMED / FAILED / EXPIRED / CANCELED / INCOMPLETE are terminal
--
-- A payment therefore cannot jump PENDING -> FAILED; it is walked through
-- PROCESSING first, so the audit trail shows the same steps a live payment
-- would have produced.
create function public.shift4_canonical_status_path(
  p_current text,
  p_target text
)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  terminal_statuses constant text[] := array[
    'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELED', 'INCOMPLETE'
  ];
begin
  if p_current is null or p_target is null then
    return null;
  end if;

  if p_current = p_target then
    return array[]::text[];
  end if;

  -- Nothing may leave a terminal state.
  if p_current = any (terminal_statuses) then
    return null;
  end if;

  if p_current = 'CREATED' then
    if p_target = 'PENDING' then return array['PENDING']; end if;
    if p_target = 'CANCELED' then return array['CANCELED']; end if;
    if p_target = 'PROCESSING' then return array['PENDING', 'PROCESSING']; end if;
    if p_target in ('EXPIRED', 'INCOMPLETE') then return array['PENDING', p_target]; end if;
    if p_target in ('CONFIRMED', 'FAILED') then
      return array['PENDING', 'PROCESSING', p_target];
    end if;
    return null;
  end if;

  if p_current = 'PENDING' then
    if p_target in ('PROCESSING', 'EXPIRED', 'CANCELED', 'INCOMPLETE') then
      return array[p_target];
    end if;
    if p_target in ('CONFIRMED', 'FAILED') then
      return array['PROCESSING', p_target];
    end if;
    return null;
  end if;

  if p_current = 'PROCESSING' then
    if p_target in ('CONFIRMED', 'FAILED') then
      return array[p_target];
    end if;
    return null;
  end if;

  return null;
end
$function$;

-- Canonical payment_events.event_type for a status. The event-type check
-- constraint accepts only the documented set, so a Shift4 step name never
-- becomes an event_type; it travels in provider_event instead.
create function public.shift4_status_event_type(p_status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case p_status
    when 'CREATED'    then 'payment.created'
    when 'PENDING'    then 'payment.pending'
    when 'PROCESSING' then 'payment.processing'
    when 'CONFIRMED'  then 'payment.confirmed'
    when 'FAILED'     then 'payment.failed'
    when 'CANCELED'   then 'payment.canceled'
    when 'EXPIRED'    then 'payment.expired'
    when 'INCOMPLETE' then 'payment.incomplete'
    else 'payment.reconciled'
  end;
$function$;

/* ══ 6. A. Atomic attempt creation ══════════════════════════════════════════ */

-- Create a Shift4 attempt BEFORE the provider request is transmitted.
--
-- Ownership is verified here rather than trusted from the caller: the payment
-- must belong to the merchant, and the provider connection must be that same
-- merchant's internal `shift4_rest` row in merchant_providers. A caller cannot
-- drive another tenant's payment by passing its id.
--
-- Returns exactly one row describing what happened:
--   created            - a new attempt was inserted
--   resumed            - the same idempotency identity and the same request
--                        fingerprint already existed; do NOT transmit again
--   idempotency_conflict - the key was reused with a different request
--   invoice_collision  - the invoice already belongs to another attempt on this
--                        provider connection; the caller MUST NOT transmit
create function public.create_shift4_payment_attempt(
  p_attempt_id text,
  p_merchant_id uuid,
  p_payment_id uuid,
  p_merchant_provider_connection_id uuid,
  p_operation text,
  p_channel text,
  p_invoice varchar(10),
  p_amount_minor bigint,
  p_currency varchar(3),
  p_idempotency_key_hash text,
  p_request_fingerprint text,
  p_correlation_id text,
  p_authorization_attempt_id text default null,
  p_refund_id text default null,
  p_authorized_amount_minor bigint default null,
  p_card_token_fingerprint text default null,
  p_attempt_number integer default 1,
  /* Generic transaction-chain parent: the referral a manual authorization
     resolves, the authorization a capture settles, or the transaction a void
     reverses. */
  p_related_attempt_id text default null,
  /* PineTree/Shift4 step inside the chain. Defaults from the endpoint when a
     caller does not distinguish, which keeps sale/capture/void/refund simple. */
  p_attempt_role text default null,
  /* The code a clerk obtained by voice. Required for manual authorization. */
  p_manual_authorization_code text default null
)
returns table (
  outcome text,
  attempt_id text,
  attempt_row_id uuid,
  invoice varchar(10),
  state text,
  recovery_state text,
  version integer,
  conflict_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_payment_merchant uuid;
  v_payment_currency text;
  v_payment_gross numeric;
  v_payment_scaled numeric;
  v_connection_provider text;
  v_connection_merchant uuid;
  v_existing public.shift4_payment_attempts%rowtype;
  v_authorization public.shift4_payment_attempts%rowtype;
  v_new public.shift4_payment_attempts%rowtype;
  v_violated_constraint text;
  v_related_id text;
  v_role text;
  v_is_child boolean;
  v_chain_id uuid;
  v_root_attempt_id text;
  v_tender_sequence integer := 1;
  v_tender_approved_total bigint := 0;
  v_payment_requested_minor bigint;
  v_group public.shift4_tender_groups%rowtype;
  v_tender_group_id uuid;
begin
  /* ── Tenancy: the payment must belong to this merchant ─────────────────── */
  select p.merchant_id, p.currency, p.gross_amount
    into v_payment_merchant, v_payment_currency, v_payment_gross
    from public.payments p
   where p.id = p_payment_id
     for update;

  -- FOUND, not a null check: a payment row whose merchant_id is somehow null
  -- must be reported as an ownership failure, never as a missing payment.
  if not found then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'payment_not_found'::text;
    return;
  end if;

  if v_payment_merchant is null then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'payment_has_no_merchant'::text;
    return;
  end if;

  if v_payment_merchant <> p_merchant_id then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'payment_not_owned_by_merchant'::text;
    return;
  end if;

  v_payment_currency := upper(btrim(coalesce(v_payment_currency, '')));
  if v_payment_currency not in ('USD', 'CAD') then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'payment_currency_is_not_supported'::text;
    return;
  end if;

  if upper(btrim(coalesce(p_currency, ''))) <> v_payment_currency then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'operation_currency_does_not_match_payment'::text;
    return;
  end if;

  if v_payment_gross is null or v_payment_gross <= 0 then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'payment_total_must_be_positive'::text;
    return;
  end if;

  v_payment_scaled := v_payment_gross * 100;
  if v_payment_scaled <> trunc(v_payment_scaled) then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'payment_total_has_sub_cent_precision'::text;
    return;
  end if;

  if v_payment_scaled > 9007199254740991 then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'payment_total_exceeds_javascript_safe_integer'::text;
    return;
  end if;
  v_payment_requested_minor := v_payment_scaled::bigint;

  /* ── Tenancy: the connection must be this merchant's shift4_rest row ────── */
  select mp.provider, mp.merchant_id
    into v_connection_provider, v_connection_merchant
    from public.merchant_providers mp
   where mp.id = p_merchant_provider_connection_id;

  if not found then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'provider_connection_not_found'::text;
    return;
  end if;

  if v_connection_merchant is distinct from p_merchant_id then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'provider_connection_not_owned_by_merchant'::text;
    return;
  end if;

  if v_connection_provider is distinct from 'shift4_rest' then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'provider_connection_is_not_shift4_rest'::text;
    return;
  end if;

  if p_operation is null or p_operation not in ('sale', 'authorization', 'capture', 'refund', 'void') then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'operation_is_not_supported'::text;
    return;
  end if;

  if p_channel is null or p_channel not in ('retail', 'ecommerce') then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'channel_is_not_supported'::text;
    return;
  end if;

  if p_invoice is null or p_invoice !~ '^[0-9]{10}$' then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'invoice_is_invalid'::text;
    return;
  end if;

  if p_amount_minor is null or p_amount_minor < 0 then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'amount_minor_is_invalid'::text;
    return;
  end if;

  if p_authorized_amount_minor is not null and p_authorized_amount_minor < 0 then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'authorized_amount_minor_is_invalid'::text;
    return;
  end if;

  /* ══ Transaction chain resolution ══════════════════════════════════════════
   * Every attempt either ESTABLISHES a chain (and its invoice) or JOINS one.
   * Roles, not endpoints, decide which - a manual authorization joins the
   * referral's chain even though both use POST /transactions/authorization.
   */
  v_related_id := coalesce(p_related_attempt_id, p_authorization_attempt_id);
  v_role := coalesce(nullif(btrim(p_attempt_role), ''), case p_operation
    when 'sale' then 'sale'
    when 'authorization' then 'authorization'
    when 'capture' then 'capture'
    when 'void' then 'void'
    when 'refund' then 'refund'
  end);

  -- referral_authorization and partial_authorization are RESOLVED roles that
  -- Shift4's response produces; a caller may not request them directly.
  if v_role is null or v_role not in (
    'sale', 'authorization', 'manual_authorization', 'capture', 'void', 'refund'
  ) then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer, 'attempt_role_is_not_requestable'::text;
    return;
  end if;

  if not (
    (p_operation = 'sale' and v_role = 'sale')
    or (p_operation = 'authorization' and v_role in ('authorization', 'manual_authorization'))
    or (p_operation = 'capture' and v_role = 'capture')
    or (p_operation = 'void' and v_role = 'void')
    or (p_operation = 'refund' and v_role = 'refund')
  ) then
    return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer,
      'attempt_role_does_not_match_operation'::text;
    return;
  end if;

  /* ── Stable idempotency identity, before lineage or tender allocation ────
   * This predicate exactly matches
   * shift4_payment_attempts_connection_operation_idem_uidx. attempt_role is
   * evidence-mutable, while operation is immutable request identity.
   */
  select * into v_existing
    from public.shift4_payment_attempts a
   where a.merchant_provider_connection_id = p_merchant_provider_connection_id
     and a.operation = p_operation
     and a.idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      return query select 'idempotency_conflict'::text, v_existing.attempt_id,
        v_existing.id, v_existing.invoice, v_existing.state, v_existing.recovery_state,
        v_existing.version, 'idempotency_key_reused_with_different_request'::text;
      return;
    end if;

    return query select 'resumed'::text, v_existing.attempt_id, v_existing.id,
      v_existing.invoice, v_existing.state, v_existing.recovery_state,
      v_existing.version, null::text;
    return;
  end if;

  v_is_child := v_role in ('manual_authorization', 'capture', 'void');

  if v_is_child then
    if v_related_id is null then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer,
        (v_role || '_requires_related_attempt')::text;
      return;
    end if;

    -- FOR SHARE keeps the parent's role, state, and amount stable between these
    -- checks and the insert, without a write lock that would deadlock against
    -- the parent's own concurrent evidence write.
    select * into v_authorization
      from public.shift4_payment_attempts a
     where a.merchant_id = p_merchant_id
       and a.attempt_id = v_related_id
       for share;

    if not found then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'related_attempt_not_found'::text;
      return;
    end if;

    if v_authorization.payment_id <> p_payment_id then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'related_attempt_belongs_to_another_payment'::text;
      return;
    end if;

    if v_authorization.merchant_provider_connection_id <> p_merchant_provider_connection_id then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer,
        'related_attempt_belongs_to_another_provider_connection'::text;
      return;
    end if;

    -- A child NEVER moves the chain to a different invoice.
    if p_invoice <> v_authorization.invoice then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'invoice_does_not_match_related_attempt'::text;
      return;
    end if;

    v_chain_id := v_authorization.chain_id;
    v_root_attempt_id := v_authorization.root_attempt_id;
    v_tender_sequence := v_authorization.tender_sequence;
    -- A child inherits its parent's tender group. It never picks its own, so a
    -- capture can never be counted against a different payment's total.
    v_tender_group_id := v_authorization.tender_group_id;
  else
    /* ── Chain root ─────────────────────────────────────────────────────── */
    if v_related_id is not null then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer,
        'root_attempt_must_not_reference_a_related_attempt'::text;
      return;
    end if;

    v_chain_id := gen_random_uuid();
    v_root_attempt_id := p_attempt_id;

    -- ONE chain may own an invoice on a connection. This is the friendly
    -- error; the partial unique index on chain roots is the race-safe
    -- authority, because two concurrent inserts can both pass this read.
    if exists (
      select 1
        from public.shift4_payment_attempts a
       where a.merchant_provider_connection_id = p_merchant_provider_connection_id
         and a.invoice = p_invoice
         and a.root_attempt_id = a.attempt_id
         and a.attempt_id <> p_attempt_id
    ) then
      return query select 'invoice_collision'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'invoice_already_owned_by_another_chain'::text;
      return;
    end if;

    v_tender_sequence := 1;
  end if;

  /* ── Manual (voice) authorization ──────────────────────────────────────── */
  if v_role = 'manual_authorization' then
    -- It resolves a referral. The PARENT's stored role is authoritative, not
    -- anything the caller asserted about it.
    if v_authorization.attempt_role <> 'referral_authorization' then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer,
        'manual_authorization_requires_a_referral_authorization'::text;
      return;
    end if;

    if p_manual_authorization_code is null
       or btrim(p_manual_authorization_code) !~ '^[A-Za-z0-9]{6}$' then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer,
        'manual_authorization_requires_an_authorization_code'::text;
      return;
    end if;

    -- Certification reuses the referral's amount as well as its invoice.
    if p_amount_minor <> v_authorization.amount_minor then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer,
        'manual_authorization_amount_must_match_the_referral'::text;
      return;
    end if;
  end if;

  /* ── Capture: settles an approved authorization in full ────────────────── */
  if v_role = 'capture' then
    if v_authorization.attempt_role not in (
      'authorization', 'manual_authorization', 'partial_authorization'
    ) or v_authorization.state <> 'approved' then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'authorization_not_approved'::text;
      return;
    end if;

    -- No invented amounts: an authorization with no authoritative provider
    -- amount evidence cannot be captured at all.
    if v_authorization.authorized_amount_minor is null then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'authorization_amount_unknown'::text;
      return;
    end if;

    -- FULL CAPTURE ONLY, and for a partial authorization that means its own
    -- APPROVED amount, never the amount originally requested.
    if p_amount_minor < v_authorization.authorized_amount_minor then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'capture_amount_below_authorized_amount'::text;
      return;
    end if;

    if p_amount_minor > v_authorization.authorized_amount_minor then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'capture_amount_exceeds_authorized_amount'::text;
      return;
    end if;
  end if;

  /* ── Void: reverses an eligible attempt in this chain ───────────────────── */
  if v_role = 'void' then
    if v_authorization.attempt_role not in (
      'sale', 'authorization', 'manual_authorization',
      'partial_authorization', 'capture'
    ) then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'void_target_is_not_a_voidable_operation'::text;
      return;
    end if;

    if v_authorization.state <> 'approved' then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'void_target_was_not_approved'::text;
      return;
    end if;
  end if;

  /* ── Tender bound: a payment may never be over-authorized ───────────────── */
  -- A later tender may only request what is still outstanding. The payment,
  -- group, and sibling rows are locked before the aggregate so two concurrent
  -- tenders cannot each read the same remainder and both succeed.
  if v_role in ('sale', 'authorization') then
    /* ── LOCK ORDER: payment -> tender group -> attempts (id) -> journal ──────
     * PostgreSQL forbids a locking clause on an aggregate result
     * (https://www.postgresql.org/docs/current/sql-select.html). The previous
     * "select sum(...) ... for share" here was INVALID SQL and would have
     * raised 0A000 on the first second tender. Rows are now locked first with
     * a plain PERFORM, and the aggregate is a separate UNLOCKED select.
     *
     * The requested total is the exact integer derived above from the locked
     * NUMERIC payments.gross_amount. It is stored immutably on the tender group,
     * which is also the sequence allocator, removing the MAX sequence race.
     */
    perform 1 from public.payments p where p.id = p_payment_id for update;

    select * into v_group
      from public.shift4_tender_groups g
     where g.payment_id = p_payment_id
       and g.merchant_provider_connection_id = p_merchant_provider_connection_id
       for update;

    if found and (
      v_payment_requested_minor <> v_group.requested_amount_minor
      or v_payment_currency <> v_group.currency
    ) then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer,
        'tender_group_does_not_match_locked_payment'::text;
      return;
    end if;

    if found then
      v_tender_group_id := v_group.id;
      v_tender_sequence := v_group.next_tender_sequence;

      -- The group, not payment_id, owns the tender remainder. A payment may
      -- have a separate group for each Shift4 REST provider connection.
      perform 1
        from public.shift4_payment_attempts a
       where a.tender_group_id = v_tender_group_id
       order by a.id
         for update;

      -- Separate, UNLOCKED aggregate over rows this transaction already holds.
      select coalesce(sum(a.approved_amount_minor), 0) into v_tender_approved_total
        from public.shift4_payment_attempts a
       where a.tender_group_id = v_tender_group_id
         and a.attempt_role in ('sale', 'authorization',
                                'referral_authorization', 'manual_authorization',
                                'partial_authorization')
         and a.state = 'approved'
         and a.approved_amount_minor is not null;
    else
      v_tender_group_id := null;
      v_tender_sequence := 1;
      -- No authoritative group exists for this connection yet, so no sibling
      -- attempt can contribute. The locked payment row serializes first-group
      -- creation without reading another connection's group or attempts.
      v_tender_approved_total := 0;
    end if;

    if v_tender_approved_total + p_amount_minor > v_payment_requested_minor then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'tender_would_exceed_payment_total'::text;
      return;
    end if;
  end if;

  /* ── Refund: a separate chain on an unused invoice ─────────────────────── */
  -- Both certification scripts are explicit: "Use a different Invoice number
  -- than the sale that you are trying to refund (the merchant could lose
  -- revenue otherwise)."
  if v_role = 'refund' then
    if exists (
      select 1
        from public.shift4_payment_attempts a
       where a.merchant_provider_connection_id = p_merchant_provider_connection_id
         and a.invoice = p_invoice
         and a.attempt_id <> p_attempt_id
    ) then
      return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
        null::text, null::text, null::integer, 'refund_must_not_reuse_an_existing_invoice'::text;
      return;
    end if;
  end if;

  /* ── Duplicate step in this chain, pre-transmission ────────────────────── */
  -- Scoped to (connection, invoice, ROLE), matching the unique index. A capture
  -- legitimately shares its authorization's invoice, and a manual
  -- authorization shares the referral's, so only a SAME-ROLE duplicate is a
  -- collision. Enforced again by the index in case two callers race past here.
  if exists (
    select 1
      from public.shift4_payment_attempts a
     where a.merchant_provider_connection_id = p_merchant_provider_connection_id
       and a.invoice = p_invoice
       and a.attempt_role = v_role
       and a.attempt_id <> p_attempt_id
  ) then
    return query select 'invoice_collision'::text, p_attempt_id, null::uuid, p_invoice,
      null::text, null::text, null::integer,
      'invoice_already_used_for_this_role_on_this_connection'::text;
    return;
  end if;

  /* ── Insert before transmission ────────────────────────────────────────── */
  begin
    -- Allocate only when this request is ready to insert. Allocation and the
    -- attempt INSERT share this exception subtransaction, so every handled
    -- unique violation rolls the group creation/increment back as well.
    if v_role in ('sale', 'authorization') then
      if v_tender_group_id is null then
        insert into public.shift4_tender_groups (
          merchant_id, payment_id, merchant_provider_connection_id,
          currency, requested_amount_minor, next_tender_sequence
        ) values (
          p_merchant_id, p_payment_id, p_merchant_provider_connection_id,
          v_payment_currency, v_payment_requested_minor, 2
        )
        returning * into v_group;
        v_tender_group_id := v_group.id;
        v_tender_sequence := 1;
      else
        update public.shift4_tender_groups g
           set next_tender_sequence = g.next_tender_sequence + 1,
               version = g.version + 1,
               updated_at = now()
         where g.id = v_tender_group_id;
      end if;
    end if;

    insert into public.shift4_payment_attempts (
      attempt_id, merchant_id, payment_id, merchant_provider_connection_id,
      operation, channel, attempt_number,
      chain_id, root_attempt_id, attempt_role, tender_group_id, tender_sequence,
      related_attempt_id, authorization_attempt_id, refund_id,
      manual_authorization_code,
      idempotency_key_hash, request_fingerprint, correlation_id, invoice,
      amount_minor, authorized_amount_minor, currency,
      state, recovery_state, card_token_fingerprint,
      request_started_at, created_at, updated_at
    ) values (
      p_attempt_id, p_merchant_id, p_payment_id, p_merchant_provider_connection_id,
      p_operation, p_channel, greatest(coalesce(p_attempt_number, 1), 1),
      v_chain_id, v_root_attempt_id, v_role, v_tender_group_id, v_tender_sequence,
      case when v_is_child then v_related_id else null end,
      case when v_role = 'capture' then v_related_id else null end,
      p_refund_id,
      case when v_role = 'manual_authorization'
           then btrim(p_manual_authorization_code) else null end,
      p_idempotency_key_hash, p_request_fingerprint, p_correlation_id, p_invoice,
      p_amount_minor,
      case
        when v_role = 'capture' then v_authorization.authorized_amount_minor
        else p_authorized_amount_minor
      end,
      upper(p_currency),
      'created', 'none', p_card_token_fingerprint,
      now(), now(), now()
    )
    returning * into v_new;
  exception
    when unique_violation then
      -- Another transaction won the race between the checks above and this
      -- insert. Read the EXACT violated constraint from the error rather than
      -- guessing by re-querying: guessing can attribute an attempt-identity
      -- collision to the invoice index, or vice versa, and each maps to a
      -- different business outcome for the caller.
      get stacked diagnostics v_violated_constraint = constraint_name;

      if v_violated_constraint = 'shift4_tender_groups_payment_connection_uidx' then
        return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
          null::text, null::text, null::integer,
          'tender_group_allocation_conflict'::text;
        return;
      end if;

      if v_violated_constraint = 'shift4_payment_attempts_connection_invoice_role_uidx' then
        return query select 'invoice_collision'::text, p_attempt_id, null::uuid,
          p_invoice, null::text, null::text, null::integer,
          'invoice_already_used_for_this_role_on_this_connection'::text;
        return;
      end if;

      -- Two unrelated origins raced for the same invoice. The partial unique
      -- index caught the loser; report it as the distinct condition it is.
      if v_violated_constraint = 'shift4_payment_attempts_connection_chain_invoice_uidx' then
        return query select 'invoice_collision'::text, p_attempt_id, null::uuid,
          p_invoice, null::text, null::text, null::integer,
          'invoice_already_owned_by_another_chain'::text;
        return;
      end if;

      if v_violated_constraint = 'shift4_payment_attempts_connection_operation_idem_uidx' then
        select * into v_existing
          from public.shift4_payment_attempts a
         where a.merchant_provider_connection_id = p_merchant_provider_connection_id
           and a.operation = p_operation
           and a.idempotency_key_hash = p_idempotency_key_hash;

        if not found then
          -- The racing transaction has not committed yet, so its row is not
          -- visible here. Report the conflict rather than inventing an outcome.
          return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
            null::text, null::text, null::integer,
            'idempotency_identity_conflict_in_flight'::text;
          return;
        end if;

        if v_existing.request_fingerprint <> p_request_fingerprint then
          return query select 'idempotency_conflict'::text, v_existing.attempt_id,
            v_existing.id, v_existing.invoice, v_existing.state,
            v_existing.recovery_state, v_existing.version,
            'idempotency_key_reused_with_different_request'::text;
          return;
        end if;

        return query select 'resumed'::text, v_existing.attempt_id, v_existing.id,
          v_existing.invoice, v_existing.state, v_existing.recovery_state,
          v_existing.version, null::text;
        return;
      end if;

      if v_violated_constraint = 'shift4_payment_attempts_merchant_attempt_uidx' then
        return query select 'rejected'::text, p_attempt_id, null::uuid, p_invoice,
          null::text, null::text, null::integer, 'attempt_identity_conflict'::text;
        return;
      end if;

      -- An unrecognized unique constraint must NOT be mapped onto a Shift4
      -- business outcome. Re-raise so it surfaces as the database error it is.
      raise;
  end;

  /* ── Durable attempt-created evidence, in the same transaction ─────────── */
  insert into public.payment_events (id, payment_id, event_type, provider_event, raw_payload)
  values (
    gen_random_uuid(), p_payment_id, 'payment.reconciled', 'shift4.attempt_created',
    jsonb_build_object(
      'shift4Event', 'shift4.attempt_created',
      'attemptId', p_attempt_id,
      'operation', p_operation,
      'attemptRole', v_role,
      'chainId', v_chain_id,
      'tenderSequence', v_tender_sequence,
      'channel', p_channel,
      'invoice', p_invoice,
      'requestedAmountMinor', p_amount_minor,
      'currency', upper(p_currency),
      'correlationId', p_correlation_id,
      'evidenceSource', 'engine.shift4.create_attempt',
      'receivedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );

  return query select 'created'::text, v_new.attempt_id, v_new.id, v_new.invoice,
    v_new.state, v_new.recovery_state, v_new.version, null::text;
end
$function$;

/* ══ 7. B. Bounded due-work claiming ════════════════════════════════════════ */

-- Claim a bounded batch of unresolved, due Shift4 attempts for one worker.
--
-- FOR UPDATE SKIP LOCKED plus a lease means two concurrent workers can never
-- take the same row: the loser skips it rather than blocking. Ordering matches
-- shift4_payment_attempts_due_work_idx exactly, so the oldest due attempt is
-- always taken first and cannot be starved.
create function public.claim_due_shift4_payment_attempts(
  p_lease_owner text,
  p_lease_seconds integer default 120,
  p_limit integer default 25,
  p_merchant_id uuid default null,
  p_merchant_provider_connection_id uuid default null,
  p_payment_id uuid default null,
  p_attempt_id text default null,
  p_now timestamptz default now()
)
returns table (
  attempt_id text,
  attempt_row_id uuid,
  merchant_id uuid,
  payment_id uuid,
  merchant_provider_connection_id uuid,
  operation text,
  channel text,
  invoice varchar(10),
  amount_minor bigint,
  authorized_amount_minor bigint,
  currency varchar(3),
  state text,
  recovery_state text,
  response_code text,
  authorization_code text,
  retrieval_reference text,
  resolution_reason text,
  lookup_attempt_count integer,
  resend_count integer,
  version integer,
  correlation_id text,
  first_unknown_at timestamptz,
  next_check_at timestamptz,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 200));
  v_seconds integer := greatest(5, least(coalesce(p_lease_seconds, 120), 900));
  -- A caller may look BACK in time to replay due work, but must not look
  -- forward and claim attempts that are not due yet.
  v_due_before timestamptz := least(coalesce(p_now, now()), now());
begin
  if p_lease_owner is null or length(btrim(p_lease_owner)) = 0 then
    raise exception 'A lease owner is required to claim Shift4 attempts';
  end if;

  return query
  with due as (
    select a.id
      from public.shift4_payment_attempts a
     where a.recovery_state = 'pending_lookup'
       and a.next_check_at is not null
       and a.next_check_at <= v_due_before
       -- Only unleased rows, or rows whose lease has expired.
       --
       -- Lease expiry is compared against SERVER time, never the caller's
       -- p_now. p_now exists so a test can control what counts as "due"; if it
       -- also governed leases, a caller passing a future timestamp would strip
       -- every live lease and hand the same attempt to a second worker.
       and (a.lease_expires_at is null or a.lease_expires_at <= now())
       and (p_merchant_id is null or a.merchant_id = p_merchant_id)
       and (
         p_merchant_provider_connection_id is null
         or a.merchant_provider_connection_id = p_merchant_provider_connection_id
       )
       and (p_payment_id is null or a.payment_id = p_payment_id)
       and (p_attempt_id is null or a.attempt_id = p_attempt_id)
     order by a.next_check_at asc, a.created_at asc, a.id asc
     limit v_limit
     for update skip locked
  )
  update public.shift4_payment_attempts target
     -- Anchored to now(), so a caller-supplied p_now in the past can never
     -- create a lease that is already expired the instant it is granted.
     set lease_owner = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => v_seconds),
         updated_at = now()
    from due
   where target.id = due.id
  returning
    target.attempt_id, target.id, target.merchant_id, target.payment_id,
    target.merchant_provider_connection_id, target.operation, target.channel,
    target.invoice, target.amount_minor, target.authorized_amount_minor,
    target.currency, target.state, target.recovery_state, target.response_code,
    target.authorization_code, target.retrieval_reference, target.resolution_reason,
    target.lookup_attempt_count, target.resend_count, target.version,
    target.correlation_id, target.first_unknown_at, target.next_check_at,
    target.lease_expires_at;
end
$function$;

/* ══ 8. C. Atomic evidence, transition, and ledger ══════════════════════════ */

-- Apply normalized Shift4 evidence to an attempt and, when the evidence
-- legitimately settles the payment, transition the payment and post the ledger
-- entry - all in ONE transaction.
--
-- This is the function that makes the whole design safe. Before it, evidence,
-- transition, and ledger posting were separate PostgREST round trips, so a
-- payment could reach CONFIRMED with a posted ledger entry and no durable record
-- of the operation, invoice, response code, or authorization code. Here they
-- commit together or not at all.
--
-- Optimistic concurrency: the caller passes the version it read. A stale writer
-- is rejected rather than allowed to overwrite fresher evidence.
--
-- ── The caller has NO financial authority ────────────────────────────────────
-- There is deliberately no `p_posts_ledger` parameter. Ledger eligibility is
-- DERIVED here from the stored attempt's operation plus the provider evidence,
-- so a caller cannot manufacture money movement by asserting a flag. The same
-- applies to the lifecycle: every operation/target/evidence combination is
-- validated, and an invalid one is refused even when invoked directly by
-- service_role.
--
--   sale           may confirm on an accepted approval code with a
--                  non-short approved amount; posts the one inbound row
--   authorization  may reach PROCESSING and nothing further; never confirms,
--                  never posts - an approval holds funds, it does not capture
--   capture        requires its linked approved authorization, a matching
--                  invoice, and an exactly equal amount; may confirm; posts
--   refund         never alters the payment lifecycle, never posts inbound
--   void           never confirms the payment, never posts inbound, and never
--                  erases the approval or capture evidence that preceded it
--
-- Only sale and capture can produce a newly confirmed inbound payment effect.
create function public.apply_shift4_attempt_evidence(
  p_merchant_id uuid,
  p_attempt_id text,
  p_expected_version integer,
  p_state text,
  p_recovery_state text,
  p_target_status text default null,
  p_shift4_event text default 'shift4.response_received',
  p_response_code text default null,
  p_primary_code integer default null,
  p_secondary_code integer default null,
  p_authorization_code text default null,
  p_retrieval_reference text default null,
  p_sale_flag text default null,
  p_card_on_file_transaction_id text default null,
  p_avs_result text default null,
  p_csc_result text default null,
  p_entry_mode text default null,
  p_entry_channel text default null,
  p_card_token_fingerprint text default null,
  p_raw_response_ref text default null,
  p_evidence_source text default 'provider_response',
  p_approved_amount_minor bigint default null,
  p_authorized_amount_minor bigint default null,
  p_provider_occurred_at timestamptz default null,
  p_received_at timestamptz default null,
  p_timeout_classification text default null,
  p_resolution_reason text default null,
  p_next_check_at timestamptz default null,
  p_first_unknown_at timestamptz default null,
  p_increment_lookup_count boolean default false,
  p_increment_resend_count boolean default false,
  p_release_lease boolean default true,
  p_mark_dispatched boolean default false,
  /* When the attempt is leased, only the lease holder may write evidence. */
  p_lease_owner text default null,
  /* Referral evidence. Non-secret operational contact details only. */
  p_voice_center_account_number text default null,
  p_voice_center_phone_number text default null
)
returns table (
  outcome text,
  attempt_id text,
  version integer,
  previous_status text,
  applied_status text,
  ledger_posted boolean,
  reconciliation_required boolean,
  conflict_reason text,
  attempt_state text,
  attempt_recovery_state text,
  attempt_resolution_reason text,
  attempt_next_check_at timestamptz,
  tender_group_state text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_attempt public.shift4_payment_attempts%rowtype;
  v_payment record;
  v_current_status text;
  v_path text[];
  v_step text;
  v_applied text := null;
  v_ledger_posted boolean := false;
  v_ledger_rows integer := 0;
  v_reconciliation boolean := false;
  v_now timestamptz := now();
  v_received timestamptz := coalesce(p_received_at, now());
  v_terminal constant text[] := array['CONFIRMED','FAILED','EXPIRED','CANCELED','INCOMPLETE'];
  v_event_payload jsonb;
  /* Shift4 response codes that represent an accepted approval. P (partial),
     R (referral), S/I (SCA), J (soft decline), f, e, X, blank, and any
     undocumented code are all excluded on purpose. */
  v_approval_codes constant text[] := array['A', 'C'];
  v_target text;
  v_effective_code text;
  v_effective_approved bigint;
  v_authorization public.shift4_payment_attempts%rowtype;
  v_ledger_eligible boolean := false;
  v_settling_eligible boolean := false;
  v_settlement_created boolean := false;
  v_fee_created boolean := false;
  v_payment_complete boolean := false;
  v_provider_clearing_account uuid;
  v_merchant_receivable_account uuid;
  v_platform_fee_account uuid;
  v_payment_event_id uuid := gen_random_uuid();
  v_network text;
  v_final_state text;
  v_final_recovery_state text;
  v_final_reason text;
  v_outcome text;
  v_conflict text;
  v_final_role text;
  v_authorized_amount bigint;
  v_remaining_amount bigint;
  v_captured_total bigint := 0;
  v_payment_requested_minor bigint;
  v_group public.shift4_tender_groups%rowtype;
  v_tender_group_id uuid;
  v_amount_problem text;
  v_state_override text;
  v_recovery_override text;
  v_final_reason_override text;
begin
  /* ── Lock the attempt and verify tenancy ───────────────────────────────── */
  select * into v_attempt
    from public.shift4_payment_attempts a
   where a.merchant_id = p_merchant_id
     and a.attempt_id = p_attempt_id;

  if not found then
    return query select 'rejected'::text, p_attempt_id, null::integer, null::text,
      null::text, false, false, 'attempt_not_found'::text,
      null::text, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  /* Fixed lock order: payment -> tender group -> attempts ordered by id ->
     journal accounts/transactions. The first attempt read above is only an
     identifier lookup; authority is re-read after the ordered locks. */
  select p.id, p.merchant_id, p.status, p.gross_amount, p.currency, p.provider,
         p.network, p.payment_url
    into v_payment
    from public.payments p
   where p.id = v_attempt.payment_id
     for update;

  if not found then
    return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
      null::text, null::text, false, false, 'payment_not_found'::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, null::text;
    return;
  end if;

  if v_attempt.tender_group_id is not null then
    select * into v_group
      from public.shift4_tender_groups g
     where g.id = v_attempt.tender_group_id
       and g.payment_id = v_attempt.payment_id
       and g.merchant_provider_connection_id = v_attempt.merchant_provider_connection_id
       for update;

    if not found then
      return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
        null::text, null::text, false, false, 'tender_group_not_found'::text,
        v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
        v_attempt.next_check_at, null::text;
      return;
    end if;

    -- Only siblings owned by this authoritative tender group participate in
    -- its evidence decision. Another Shift4 connection on the same payment is
    -- an independent group and must not be locked or observed here.
    perform 1
      from public.shift4_payment_attempts a
     where a.tender_group_id = v_group.id
     order by a.id
       for update;
  else
    -- Refunds may intentionally have no tender group. Lock only the current
    -- attempt; there is no authoritative sibling set to lock or aggregate.
    perform 1
      from public.shift4_payment_attempts a
     where a.id = v_attempt.id
       for update;
  end if;

  select * into v_attempt
    from public.shift4_payment_attempts a
   where a.merchant_id = p_merchant_id
     and a.attempt_id = p_attempt_id;

  /* ── Reject a stale writer ─────────────────────────────────────────────── */
  -- Required, never optional. Allowing a null to skip the check would give any
  -- caller a silent way to clobber fresher evidence.
  if p_expected_version is null then
    return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
      null::text, null::text, false, false, 'expected_version_required'::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  if v_attempt.version <> p_expected_version then
    return query select 'version_conflict'::text, v_attempt.attempt_id, v_attempt.version,
      null::text, null::text, false, false, 'attempt_modified_by_another_writer'::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  /* ── A leased attempt may only be written by its live lease holder ─────── */
  -- Claiming does not bump `version`, so two workers can legitimately hold the
  -- same version number; the lease, not the version, decides who may speak for
  -- the attempt.
  --
  -- An EXPIRED lease is refused outright, even for the recorded holder. A
  -- worker whose lease lapsed has no authority just because nothing has
  -- reclaimed the row yet - its provider call may have taken longer than the
  -- lease, and a newer worker may already be acting on the same attempt.
  if v_attempt.lease_owner is not null then
    if v_attempt.lease_expires_at is null or v_attempt.lease_expires_at <= now() then
      return query select 'lease_expired'::text, v_attempt.attempt_id, v_attempt.version,
        null::text, null::text, false, false, 'attempt_lease_expired'::text,
        v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
        v_attempt.next_check_at, v_group.state;
      return;
    end if;

    if p_lease_owner is null or length(btrim(p_lease_owner)) = 0
       or p_lease_owner <> v_attempt.lease_owner then
      return query select 'lease_conflict'::text, v_attempt.attempt_id, v_attempt.version,
        null::text, null::text, false, false, 'attempt_leased_by_another_worker'::text,
        v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
        v_attempt.next_check_at, v_group.state;
      return;
    end if;
  end if;

  /* ── Lock the payment so the transition check cannot be raced ──────────── */
  select p.id, p.merchant_id, p.status, p.gross_amount, p.currency, p.provider,
         p.network, p.payment_url
    into v_payment
    from public.payments p
   where p.id = v_attempt.payment_id
     for update;

  if not found then
    return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
      null::text, null::text, false, false, 'payment_not_found'::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  /* ── Re-verify ownership of the payment itself ─────────────────────────── */
  -- The attempt was found by merchant_id, but its payment_id is a stored value.
  -- Re-checking here means a corrupted or mis-created attempt row can never be
  -- used to transition another tenant's payment or post to their ledger.
  if v_payment.merchant_id is distinct from p_merchant_id then
    return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
      null::text, null::text, false, false, 'payment_not_owned_by_merchant'::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  v_current_status := upper(coalesce(v_payment.status, 'CREATED'));
  v_target := nullif(upper(coalesce(p_target_status, '')), '');

  /* ══ Operation-aware authority ═════════════════════════════════════════════
   * Everything financial is derived here from the STORED operation and the
   * provider evidence. The caller supplies evidence and a requested target; it
   * does not get to decide what that evidence means.
   */
  v_effective_code := coalesce(p_response_code, v_attempt.response_code);
  v_effective_approved := coalesce(p_approved_amount_minor, v_attempt.approved_amount_minor);

  -- Amount consistency is derived from the response code itself, regardless of
  -- the caller's requested state/target. Only P can be a partial approval.
  if v_effective_code = any (v_approval_codes) then
    if v_effective_approved is null then
      v_amount_problem := 'approved_amount_missing';
    elsif v_effective_approved < v_attempt.amount_minor then
      v_amount_problem := 'approved_amount_below_requested';
    elsif v_effective_approved > v_attempt.amount_minor then
      v_amount_problem := 'approved_amount_exceeds_requested';
    end if;
  elsif v_effective_code = 'P' then
    if v_effective_approved is null then
      v_amount_problem := 'approved_amount_missing';
    elsif v_effective_approved <= 0
          or v_effective_approved >= v_attempt.amount_minor then
      v_amount_problem := 'partial_approved_amount_not_below_requested';
    end if;
  end if;

  /* Which targets each operation may ever request. */
  if v_attempt.operation = 'authorization' and v_target is not null
     and v_target <> 'PROCESSING' then
    return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
      v_current_status, null::text, false, false,
      'authorization_may_only_reach_processing'::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  if v_attempt.operation in ('refund', 'void') and v_target is not null then
    return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
      v_current_status, null::text, false, false,
      (v_attempt.operation || '_must_not_change_payment_lifecycle')::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  if v_attempt.operation in ('sale', 'capture') and v_target is not null
     and v_target not in ('PROCESSING', 'CONFIRMED', 'FAILED') then
    return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
      v_current_status, null::text, false, false,
      'unsupported_target_status_for_operation'::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  /* A confirmation must be backed by real approval evidence. */
  if v_target = 'CONFIRMED' then
    if v_attempt.operation not in ('sale', 'capture') then
      return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
        v_current_status, null::text, false, false,
        'only_sale_or_capture_may_confirm_a_payment'::text,
        v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
        v_attempt.next_check_at, v_group.state;
      return;
    end if;

    if p_state <> 'approved' then
      return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
        v_current_status, null::text, false, false,
        'confirmation_requires_an_approved_attempt_state'::text,
        v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
        v_attempt.next_check_at, v_group.state;
      return;
    end if;

    -- Provider evidence, not caller opinion. Partial, referral, SCA, soft
    -- decline, blank, and undocumented codes all fail here.
    if v_effective_code is null or not (v_effective_code = any (v_approval_codes)) then
      return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
        v_current_status, null::text, false, false,
        'confirmation_requires_an_accepted_approval_code'::text,
        v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
        v_attempt.next_check_at, v_group.state;
      return;
    end if;

    -- The approved total must be PRESENT and EXACTLY equal to what was
    -- requested. A missing approved amount is no amount evidence at all, and an
    -- approval for MORE than requested would confirm a figure PineTree never
    -- asked for. Compared as integer minor units, never as a float.
    --
    -- These are NOT hard rejections: the provider evidence still has to be
    -- persisted. The transition and the ledger are refused instead, and the
    -- attempt is routed to lookup or reconciliation below.
    if v_effective_approved is null then
      v_amount_problem := 'approved_amount_missing';
    elsif v_effective_approved < v_attempt.amount_minor then
      v_amount_problem := 'approved_amount_below_requested';
    elsif v_effective_approved > v_attempt.amount_minor then
      v_amount_problem := 'approved_amount_exceeds_requested';
    end if;

    /* A capture must still satisfy its authorization at settlement time. */
    if v_attempt.operation = 'capture' then
      select * into v_authorization
        from public.shift4_payment_attempts a
       where a.merchant_id = v_attempt.merchant_id
         and a.attempt_id = v_attempt.related_attempt_id
         for share;

      if not found or v_authorization.operation <> 'authorization'
         or v_authorization.state <> 'approved' then
        return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
          v_current_status, null::text, false, false,
          'capture_requires_a_linked_approved_authorization'::text,
          v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
          v_attempt.next_check_at, v_group.state;
        return;
      end if;

      if v_authorization.invoice <> v_attempt.invoice then
        return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
          v_current_status, null::text, false, false,
          'capture_invoice_does_not_match_authorization'::text,
          v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
          v_attempt.next_check_at, v_group.state;
        return;
      end if;

      if v_authorization.authorized_amount_minor is null
         or v_attempt.amount_minor <> v_authorization.authorized_amount_minor then
        return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
          v_current_status, null::text, false, false,
          'capture_amount_must_equal_authorized_amount'::text,
          v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
          v_attempt.next_check_at, v_group.state;
        return;
      end if;
    end if;

    -- Everything above held, so this confirmation may settle money.
    v_ledger_eligible := true;
  end if;

  -- Financial posting is derived from provider evidence, independently of the
  -- mapper's lifecycle recommendation. A partially approved sale has moved
  -- real money even though another tender is still required.
  v_settling_eligible :=
    v_attempt.operation in ('sale', 'capture')
    and v_effective_approved is not null
    and v_effective_approved > 0
    and (
      (v_effective_code = any (v_approval_codes)
       and v_effective_approved = v_attempt.amount_minor)
      or (v_attempt.operation = 'sale'
          and v_effective_code = 'P'
          and v_effective_approved < v_attempt.amount_minor)
    );
  v_ledger_eligible := v_settling_eligible;

  /* ══ Evidence-driven role and authorization amount ═════════════════════════
   * Shift4's RESPONSE decides whether an authorization became a referral or a
   * partial approval, and what amount it actually authorized. None of it is
   * taken from the request, and none of it is taken from the caller.
   */
  v_final_role := v_attempt.attempt_role;
  v_authorized_amount := null;
  v_remaining_amount := null;

  if v_attempt.attempt_role in (
    'authorization', 'referral_authorization', 'manual_authorization', 'partial_authorization'
  ) then
    if v_amount_problem is not null
       and v_final_role = 'partial_authorization' then
      v_final_role := 'authorization';
    end if;

    if v_effective_code = 'R' then
      -- Referral: a clerk must telephone for approval. Not an authorization.
      v_final_role := 'referral_authorization';

    elsif v_effective_code = 'P' then
      -- Partial approval is exclusively a P response with a positive amount
      -- strictly below the request. Every other P amount is inconsistent.
      if v_amount_problem is null then
        v_final_role := 'partial_authorization';
        v_authorized_amount := v_effective_approved;
        v_remaining_amount := v_attempt.amount_minor - v_effective_approved;
      end if;

    elsif p_state = 'approved' and v_effective_code = any (v_approval_codes) then
      -- A full authorization must state its amount, exactly.
      if v_amount_problem is null then
        v_authorized_amount := v_effective_approved;
      end if;
    end if;
  end if;

  /* ── An amount problem refuses money but never discards evidence ────────── */
  if v_amount_problem is not null then
    v_ledger_eligible := false;
    v_target := null;
    if v_amount_problem = 'approved_amount_missing' then
      -- Only an invoice lookup can supply the missing total.
      v_state_override := 'unresolved';
      v_recovery_override := 'pending_lookup';
    else
      -- The amount is known and wrong: an operator decides.
      v_state_override := 'reconciliation_required';
      v_recovery_override := 'blocked';
    end if;
  end if;

  /* ══ Split-tender aggregation ══════════════════════════════════════════════
   * A payment may be satisfied by several tenders (partial approval, split
   * tender). It confirms ONLY when the captured total equals the requested
   * total exactly - never on the first capture of several.
   *
   * The sum is taken under FOR UPDATE, in the same transaction as the
   * transition, so two concurrent captures cannot both read the same total and
   * both decide they completed the payment.
   */
  if v_settling_eligible then
    /* ── LOCK ORDER: payment -> tender group -> attempts (id) -> journal ──────
     * The payment row is already locked FOR UPDATE above. The previous
     * "select sum(...), count(*) ... for update" here was INVALID SQL - a
     * locking clause on an aggregate result - and would have raised 0A000 on
     * the first capture. Rows are locked first, aggregate second, unlocked.
     */
    select * into v_group
      from public.shift4_tender_groups g
     where g.id = v_group.id
       for update;

    if not found then
      return query select 'rejected'::text, v_attempt.attempt_id, v_attempt.version,
        v_current_status, null::text, false, false, 'tender_group_not_found'::text,
        v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
        v_attempt.next_check_at, null::text;
      return;
    end if;

    perform 1
      from public.shift4_payment_attempts a
     where a.tender_group_id = v_group.id
     order by a.id
       for update;

    -- Separate, UNLOCKED aggregate over rows this transaction already holds.
    select coalesce(sum(a.approved_amount_minor), 0)
      into v_captured_total
      from public.shift4_payment_attempts a
     where a.tender_group_id = v_group.id
       and a.operation in ('sale', 'capture')
       and (
         (a.response_code in ('A', 'C')
          and a.approved_amount_minor = a.amount_minor)
         or (a.operation = 'sale' and a.response_code = 'P'
             and a.approved_amount_minor > 0
             and a.approved_amount_minor < a.amount_minor)
       )
       and a.attempt_id <> v_attempt.attempt_id;

    -- This capture's own contribution, from provider evidence only.
    v_captured_total := v_captured_total + coalesce(v_effective_approved, 0);
    -- Authoritative integer total. Never round(gross_amount * 100).
    v_payment_requested_minor := v_group.requested_amount_minor;

    if v_captured_total < v_payment_requested_minor then
      -- Tender is incomplete. The payment stays mid-lifecycle and waits for the
      -- remaining tender. This tender's real money movement is journaled, but
      -- the overall payment is not yet confirmed.
      v_target := 'PROCESSING';
      v_final_reason_override := 'tender_incomplete';

    elsif v_captured_total > v_payment_requested_minor then
      -- Overfunded. Never confirm; an operator must resolve it.
      v_target := null;
      v_state_override := 'reconciliation_required';
      v_recovery_override := 'blocked';
      v_final_reason_override := 'captured_total_exceeds_payment_total';

    elsif v_payment_requested_minor < 15 then
      /* The fixed 15-minor-unit fee cannot exceed the payment total. This is
         a pricing exception, not an accounting or rounding shortcut. */
      v_state_override := 'reconciliation_required';
      v_recovery_override := 'blocked';
      v_final_reason_override := 'payment_total_below_platform_fee';
    else
      v_target := 'CONFIRMED';
      v_payment_complete := true;
    end if;

    update public.shift4_tender_groups g
       set state = case
             when v_payment_complete then 'settled'
             when v_final_reason_override in (
               'captured_total_exceeds_payment_total',
               'payment_total_below_platform_fee'
             ) then 'reconciliation_required'
             else 'open'
           end,
           version = g.version + 1,
           updated_at = v_now
     where g.id = v_group.id
    returning * into v_group;
  end if;

  /* ══ Decide the attempt's final state BEFORE writing ═══════════════════════
   * One accepted evidence application performs exactly ONE version increment.
   * The reconciliation branches therefore fold their state into this single
   * update instead of writing a second time.
   */
  v_final_state := coalesce(v_state_override, p_state);
  v_final_recovery_state := coalesce(v_recovery_override, p_recovery_state);
  v_final_reason := coalesce(v_final_reason_override, v_amount_problem, p_resolution_reason);
  v_outcome := 'evidence_recorded';
  v_conflict := null;

  if v_amount_problem in (
    'approved_amount_below_requested',
    'approved_amount_exceeds_requested',
    'partial_approved_amount_not_below_requested'
  ) then
    -- Known inconsistent provider amounts must report the same reconciliation
    -- contract that is persisted. Missing amount evidence remains a lookup.
    v_outcome := 'reconciliation_required';
    v_conflict := v_amount_problem;
  elsif v_final_reason_override in (
    'captured_total_exceeds_payment_total', 'payment_total_below_platform_fee'
  ) then
    v_outcome := 'reconciliation_required';
    v_conflict := v_final_reason_override;
  elsif v_target is not null then
    if v_current_status = v_target then
      -- Duplicate evidence for a transition already applied. The evidence is
      -- still recorded (append-only audit), but no second transition or ledger
      -- effect occurs.
      v_outcome := 'already_applied';
    elsif v_current_status = any (v_terminal) then
      -- Late success must never overwrite a terminal payment.
      v_outcome := 'reconciliation_required';
      v_conflict := 'payment_already_terminal';
      v_final_state := 'reconciliation_required';
      v_final_recovery_state := 'blocked';
      v_final_reason := 'late_provider_outcome_after_terminal_state';
      v_ledger_eligible := false;
    else
      v_path := public.shift4_canonical_status_path(v_current_status, v_target);
      if v_path is null then
        v_outcome := 'reconciliation_required';
        v_conflict := 'illegal_lifecycle_transition';
        v_final_state := 'reconciliation_required';
        v_final_recovery_state := 'blocked';
        v_final_reason := 'illegal_lifecycle_transition';
        v_ledger_eligible := false;
      else
        v_outcome := 'applied';
      end if;
    end if;
  end if;

  /* ── Update the attempt with normalized evidence ───────────────────────── */
  -- THE single version increment for this evidence application.
  update public.shift4_payment_attempts a
     set state = v_final_state,
         recovery_state = v_final_recovery_state,
         attempt_role = v_final_role,
         voice_center_account_number =
           coalesce(p_voice_center_account_number, a.voice_center_account_number),
         voice_center_phone_number =
           coalesce(p_voice_center_phone_number, a.voice_center_phone_number),
         remaining_amount_minor = case
           when v_amount_problem is not null then null
           else coalesce(v_remaining_amount, a.remaining_amount_minor)
         end,
         response_code = coalesce(p_response_code, a.response_code),
         primary_code = coalesce(p_primary_code, a.primary_code),
         secondary_code = coalesce(p_secondary_code, a.secondary_code),
         authorization_code = coalesce(p_authorization_code, a.authorization_code),
         retrieval_reference = coalesce(p_retrieval_reference, a.retrieval_reference),
         sale_flag = coalesce(p_sale_flag, a.sale_flag),
         card_on_file_transaction_id =
           coalesce(p_card_on_file_transaction_id, a.card_on_file_transaction_id),
         avs_result = coalesce(p_avs_result, a.avs_result),
         csc_result = coalesce(p_csc_result, a.csc_result),
         entry_mode = coalesce(p_entry_mode, a.entry_mode),
         entry_channel = coalesce(p_entry_channel, a.entry_channel),
         card_token_fingerprint =
           coalesce(p_card_token_fingerprint, a.card_token_fingerprint),
         raw_response_ref = coalesce(p_raw_response_ref, a.raw_response_ref),
         evidence_source = coalesce(p_evidence_source, a.evidence_source),
         approved_amount_minor = coalesce(p_approved_amount_minor, a.approved_amount_minor),
         -- ONLY from provider evidence. There is deliberately no fallback to
         -- the requested amount: an authorization must never invent what it
         -- authorized.
         authorized_amount_minor = case
           when v_amount_problem is not null then null
           else coalesce(v_authorized_amount, a.authorized_amount_minor)
         end,
         provider_occurred_at = coalesce(p_provider_occurred_at, a.provider_occurred_at),
         received_at = v_received,
         request_dispatched_at = case
           when p_mark_dispatched then coalesce(a.request_dispatched_at, v_now)
           else a.request_dispatched_at
         end,
         timeout_classification =
           coalesce(p_timeout_classification, a.timeout_classification),
         resolution_reason = coalesce(v_final_reason, a.resolution_reason),
         first_unknown_at = coalesce(a.first_unknown_at, p_first_unknown_at),
         next_check_at = case
           when v_final_recovery_state = 'pending_lookup' then p_next_check_at
           else null
         end,
         last_lookup_at = case
           when p_increment_lookup_count then v_now else a.last_lookup_at
         end,
         lookup_attempt_count = a.lookup_attempt_count
           + case when p_increment_lookup_count then 1 else 0 end,
         resend_count = a.resend_count
           + case when p_increment_resend_count then 1 else 0 end,
         resolved_at = case
           when v_final_recovery_state = 'resolved' then coalesce(a.resolved_at, v_now)
           else a.resolved_at
         end,
         lease_owner = case when p_release_lease then null else a.lease_owner end,
         lease_expires_at = case when p_release_lease then null else a.lease_expires_at end,
         version = a.version + 1,
         updated_at = v_now
   where a.id = v_attempt.id
  returning * into v_attempt;

  /* ── Business-critical evidence. NOT best-effort: a failure here aborts the
        whole transaction, so a payment can never be CONFIRMED with a posted
        ledger entry and no durable record of why. ───────────────────────── */
  v_event_payload := jsonb_build_object(
    'shift4Event', p_shift4_event,
    'attemptId', v_attempt.attempt_id,
    'operation', v_attempt.operation,
    'channel', v_attempt.channel,
    'invoice', v_attempt.invoice,
    'responseCode', p_response_code,
    'providerReference', v_attempt.retrieval_reference,
    'authorizationCode', v_attempt.authorization_code,
    'approvedAmountMinor', v_attempt.approved_amount_minor,
    'requestedAmountMinor', v_attempt.amount_minor,
    'currency', v_attempt.currency,
    'evidenceSource', coalesce(p_evidence_source, 'provider_response'),
    'correlationId', v_attempt.correlation_id,
    'providerOccurredAt', p_provider_occurred_at,
    'receivedAt', v_received,
    'rawResponseRef', v_attempt.raw_response_ref,
    'attemptState', v_attempt.state,
    'recoveryState', v_attempt.recovery_state
  );

  insert into public.payment_events (id, payment_id, event_type, provider_event, raw_payload)
  values (
    v_payment_event_id, v_attempt.payment_id, 'payment.reconciled',
    p_shift4_event, v_event_payload
  );

  /* Every genuine settling result posts its own balanced economic event before
     any canonical confirmation decision. Duplicate, lookup, recovery, and late
     success paths derive the same posting key and therefore collapse safely. */
  if v_settling_eligible then
    v_network := coalesce(nullif(lower(btrim(v_payment.network)), ''), 'shift4');
    v_provider_clearing_account := public.resolve_ledger_account(
      'provider', v_attempt.merchant_provider_connection_id::text,
      'provider_clearing', v_attempt.currency, v_network, 'minor', 2
    );
    v_merchant_receivable_account := public.resolve_ledger_account(
      'merchant', v_attempt.merchant_id::text,
      'merchant_receivable', v_attempt.currency, v_network, 'minor', 2
    );

    select posted.created into v_settlement_created
      from public.post_ledger_transaction(
        p_posting_key => 'shift4.' || v_attempt.operation || '.v1|'
          || v_attempt.merchant_id::text || '|' || v_attempt.attempt_id,
        p_posting_version => 'v1',
        p_event_type => 'shift4.' || v_attempt.operation,
        p_lifecycle_domain => 'payment',
        p_merchant_id => v_attempt.merchant_id,
        p_currency_or_asset => v_attempt.currency,
        p_lines => jsonb_build_array(
          jsonb_build_object(
            'account_id', v_provider_clearing_account,
            'side', 'debit',
            'amount_minor', v_effective_approved,
            'memo', 'Shift4 provider clearing'
          ),
          jsonb_build_object(
            'account_id', v_merchant_receivable_account,
            'side', 'credit',
            'amount_minor', v_effective_approved,
            'memo', 'Merchant gross receivable'
          )
        ),
        p_links => jsonb_build_array(
          jsonb_build_object(
            'link_type', 'payment', 'record_id', v_attempt.payment_id::text,
            'payment_id', v_attempt.payment_id
          ),
          jsonb_build_object(
            'link_type', 'payment_attempt', 'record_id', v_attempt.attempt_id,
            'payment_id', v_attempt.payment_id,
            'payment_attempt_id', v_attempt.attempt_id
          ),
          jsonb_build_object(
            'link_type', 'payment_event', 'record_id', v_payment_event_id::text,
            'payment_id', v_attempt.payment_id,
            'payment_event_id', v_payment_event_id
          )
        ),
        p_network => v_network,
        p_occurred_at => coalesce(v_attempt.provider_occurred_at, v_received),
        p_source => 'engine.shift4',
        p_unit => 'minor',
        p_precision => 2
      ) posted;
  end if;

  /* PineTree's fixed fee is one economic event per overall payment. It is
     posted only on the exact-completion path and never attached to one tender. */
  if v_payment_complete and v_outcome = 'applied' then
    v_platform_fee_account := public.resolve_ledger_account(
      'platform', 'pinetree', 'platform_fee_receivable',
      v_attempt.currency, v_network, 'minor', 2
    );

    select posted.created into v_fee_created
      from public.post_ledger_transaction(
        p_posting_key => 'shift4.platform_fee.v1|'
          || v_attempt.merchant_id::text || '|' || v_attempt.payment_id::text,
        p_posting_version => 'v1',
        p_event_type => 'shift4.platform_fee',
        p_lifecycle_domain => 'fee',
        p_merchant_id => v_attempt.merchant_id,
        p_currency_or_asset => v_attempt.currency,
        p_lines => jsonb_build_array(
          jsonb_build_object(
            'account_id', v_merchant_receivable_account,
            'side', 'debit', 'amount_minor', 15,
            'memo', 'PineTree Platform Fee'
          ),
          jsonb_build_object(
            'account_id', v_platform_fee_account,
            'side', 'credit', 'amount_minor', 15,
            'memo', 'PineTree Platform Fee'
          )
        ),
        p_links => jsonb_build_array(
          jsonb_build_object(
            'link_type', 'payment', 'record_id', v_attempt.payment_id::text,
            'payment_id', v_attempt.payment_id
          ),
          jsonb_build_object(
            'link_type', 'payment_event', 'record_id', v_payment_event_id::text,
            'payment_id', v_attempt.payment_id,
            'payment_event_id', v_payment_event_id
          )
        ),
        p_network => v_network,
        p_occurred_at => coalesce(v_attempt.provider_occurred_at, v_received),
        p_source => 'engine.shift4',
        p_pricing_version => 'pinetree.standard.v1',
        p_unit => 'minor',
        p_precision => 2
      ) posted;
  end if;

  v_ledger_posted := coalesce(v_settlement_created, false)
    or coalesce(v_fee_created, false);

  /* ── Evidence only, or a duplicate of an already-applied transition ────── */
  -- Both record the evidence (append-only audit) and advance the version
  -- exactly once, but neither produces a transition or a ledger effect.
  if v_outcome in ('evidence_recorded', 'already_applied') then
    return query select v_outcome, v_attempt.attempt_id, v_attempt.version,
      v_current_status,
      case when v_outcome = 'already_applied' then v_current_status else null end,
      v_ledger_posted, false, null::text,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  /* ── Reconciliation: late success, or an illegal transition ────────────── */
  -- The attempt's state and reason were already persisted by the single update
  -- above; this only writes the exception evidence and reports it.
  if v_outcome = 'reconciliation_required' then
    insert into public.payment_events (id, payment_id, event_type, provider_event, raw_payload)
    values (
      gen_random_uuid(), v_attempt.payment_id, 'payment.reconciled',
      'shift4.reconciliation_required',
      v_event_payload || jsonb_build_object(
        'reason', v_conflict,
        'currentStatus', v_current_status,
        'recommendedStatus', v_target
      )
    );

    return query select 'reconciliation_required'::text, v_attempt.attempt_id,
      v_attempt.version, v_current_status, null::text, v_ledger_posted, true, v_conflict,
      v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
      v_attempt.next_check_at, v_group.state;
    return;
  end if;

  /* ── Walk the legal canonical path decided above ───────────────────────── */
  foreach v_step in array v_path loop
    update public.payments
       set status = v_step,
           updated_at = v_now
     where id = v_attempt.payment_id;

    insert into public.payment_events (id, payment_id, event_type, provider_event, raw_payload)
    values (
      gen_random_uuid(), v_attempt.payment_id,
      public.shift4_status_event_type(v_step),
      'shift4.' || v_attempt.operation,
      v_event_payload || jsonb_build_object(
        'appliedStatus', v_step,
        'previousStatus', v_current_status
      )
    );

    v_current_status := v_step;
    v_applied := v_step;
  end loop;

  /* Legacy compatibility projection. Canonical money movement and the
     once-per-payment fee were posted to the balanced journal above. The flat
     legacy table receives one aggregate row only at exact confirmation. */
  if v_payment_complete and v_applied = 'CONFIRMED' then
    insert into public.ledger_entries (
      merchant_id, payment_id, provider, network, asset,
      amount, usd_value, wallet_address, direction, status
    ) values (
      v_payment.merchant_id, v_payment.id, v_payment.provider, v_payment.network,
      v_payment.currency, v_payment.gross_amount, v_payment.gross_amount,
      v_payment.payment_url, 'INBOUND', 'CONFIRMED'
    )
    on conflict (payment_id) do nothing;

    -- ON CONFLICT DO NOTHING reports 0 rows when the entry already existed, so
    -- this distinguishes "posted now" from "already posted" without a second read.
    get diagnostics v_ledger_rows = row_count;
    v_ledger_posted := v_ledger_posted or v_ledger_rows > 0;
  end if;

  return query select 'applied'::text, v_attempt.attempt_id, v_attempt.version,
    v_payment.status, v_applied, v_ledger_posted, v_reconciliation, null::text,
    v_attempt.state, v_attempt.recovery_state, v_attempt.resolution_reason,
    v_attempt.next_check_at, v_group.state;
end
$function$;

/* ══ 9. D. Explicit lease release ═══════════════════════════════════════════ */

-- apply_shift4_attempt_evidence releases the lease itself on the normal path.
-- This exists for the abnormal one: a worker that claimed an attempt and then
-- failed before producing any evidence must be able to hand the row back
-- immediately instead of stranding it until the lease expires.
create function public.release_shift4_attempt_lease(
  p_merchant_id uuid,
  p_attempt_id text,
  p_lease_owner text,
  p_next_check_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_released integer := 0;
begin
  -- A null or blank owner is never a valid releaser. Without this, `is not
  -- distinct from` would let a null caller match an UNLEASED row and report a
  -- successful release of a lease that never existed.
  if p_lease_owner is null or length(btrim(p_lease_owner)) = 0 then
    raise exception 'A lease owner is required to release a Shift4 attempt lease';
  end if;

  update public.shift4_payment_attempts a
     set lease_owner = null,
         lease_expires_at = null,
         next_check_at = coalesce(p_next_check_at, a.next_check_at),
         updated_at = now()
   where a.merchant_id = p_merchant_id
     and a.attempt_id = p_attempt_id
     -- Exact match on the STILL-RECORDED holder. A worker may hand back its own
     -- lease even after it expired - that is just tidying up - but it can never
     -- clear a lease that a newer worker has since been granted, because by
     -- then lease_owner no longer equals this caller.
     and a.lease_owner = p_lease_owner;

  get diagnostics v_released = row_count;
  return v_released > 0;
end
$function$;

/* ══ 10. Privileges ═════════════════════════════════════════════════════════ */

-- ── Pure helpers: invoker rights, no elevation ───────────────────────────────
-- shift4_canonical_status_path and shift4_status_event_type are deterministic
-- mapping functions. They read no table, touch no protected data, and are
-- declared IMMUTABLE, so they are deliberately NOT security definer.
--
-- They are also not granted to service_role. Nothing calls them over RPC; their
-- only callers are the SECURITY DEFINER functions below, which execute as this
-- migration's owner and hold EXECUTE by ownership. Granting them separately
-- would widen the surface for no benefit.
revoke all on function public.shift4_canonical_status_path(text, text) from public;
revoke all on function public.shift4_canonical_status_path(text, text) from anon;
revoke all on function public.shift4_canonical_status_path(text, text) from authenticated;
revoke all on function public.shift4_status_event_type(text) from public;
revoke all on function public.shift4_status_event_type(text) from anon;
revoke all on function public.shift4_status_event_type(text) from authenticated;
revoke all on function public.shift4_tender_group_identity_is_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.shift4_tender_group_is_undeletable()
  from public, anon, authenticated, service_role;
revoke all on function public.create_shift4_payment_attempt(
  text, uuid, uuid, uuid, text, text, varchar, bigint, varchar,
  text, text, text, text, text, bigint, text, integer, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.claim_due_shift4_payment_attempts(
  text, integer, integer, uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.apply_shift4_attempt_evidence(
  uuid, text, integer, text, text, text, text, text, integer, integer,
  text, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, timestamptz, timestamptz, text, text, timestamptz, timestamptz,
  boolean, boolean, boolean, boolean, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.release_shift4_attempt_lease(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.create_shift4_payment_attempt(
  text, uuid, uuid, uuid, text, text, varchar, bigint, varchar,
  text, text, text, text, text, bigint, text, integer, text, text, text
) to service_role;
grant execute on function public.claim_due_shift4_payment_attempts(
  text, integer, integer, uuid, uuid, uuid, text, timestamptz
) to service_role;
grant execute on function public.apply_shift4_attempt_evidence(
  uuid, text, integer, text, text, text, text, text, integer, integer,
  text, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, timestamptz, timestamptz, text, text, timestamptz, timestamptz,
  boolean, boolean, boolean, boolean, text, text, text
) to service_role;
grant execute on function public.release_shift4_attempt_lease(uuid, text, text, timestamptz)
  to service_role;

-- ── Least-privilege table access ─────────────────────────────────────────────
-- SELECT and nothing else.
--
-- Every mutation - create, evidence, transition, ledger, claim, lease release -
-- runs inside a SECURITY DEFINER function, which executes as this migration's
-- owner and therefore needs no privilege of its own on the table. The service
-- role's only direct table access is three tenant-scoped reads in
-- database/shift4PaymentAttempts.ts:
--
--   getShift4PaymentAttempt      .select(SAFE_COLUMNS).eq(merchant_id).eq(attempt_id)
--   listShift4PaymentAttempts    .select(SAFE_COLUMNS).eq(merchant_id).eq(payment_id)
--   listDueShift4PaymentAttempts .select(SAFE_COLUMNS)  -- reconciliation dry run
--
-- There is no direct INSERT, UPDATE, UPSERT, or DELETE anywhere in that module,
-- so no write privilege is justified. DELETE and TRUNCATE are withheld outright:
-- an attempt row is financial evidence and must not be removable by application
-- credentials. REFERENCES and TRIGGER are withheld because nothing needs them.
grant select on public.shift4_payment_attempts to service_role;

notify pgrst, 'reload schema';

commit;
