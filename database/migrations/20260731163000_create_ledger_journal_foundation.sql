-- PineTree balanced-journal accounting foundation.
--
-- ── Why this exists ──────────────────────────────────────────────────────────
-- public.ledger_entries is a LEGACY OPERATIONAL POSTING MODEL: one flat row per
-- payment, keyed by a unique payment_id, with a single signed amount and a
-- direction string. It cannot represent two capture effects on one payment, a
-- refund after an inbound payment, a platform fee as its own line, or balanced
-- debits and credits. Shift4 split tender needs all of those.
--
-- The Financial Ledger, Money, and Reconciliation Standard (v1.0) requires an
-- append-only journal with balanced postings: ledger_accounts,
-- ledger_transactions, ledger entries, and lifecycle links, with deterministic
-- unique posting keys and corrections made through new reversing transactions.
--
-- This migration creates that journal GENERICALLY, for the whole platform. It
-- is not a Shift4 ledger. Base, Solana, Speed, Stripe, and FluidPay can adopt
-- it later without schema change.
--
-- ── What this migration does NOT do ─────────────────────────────────────────
--   * It does not alter, rename, or delete public.ledger_entries. That table
--     remains the read-model every existing report uses, untouched, until a
--     separately reviewed platform-wide cutover.
--   * It does not back-fill history. Existing rows stay where they are.
--   * It changes no other rail's behavior.
--
-- The entity is named `ledger_journal_entries` rather than `ledger_entries`
-- because that name is already taken by the legacy table. See
-- docs/architecture/adr-0001-ledger-journal-entries.md.
--
-- Strict first deployment: plain CREATE throughout, so a pre-existing object
-- fails loudly rather than being silently adopted.

begin;

/* ══ 0a. First-deployment preflight ═════════════════════════════════════════ */

do $existing_objects$
declare
  found_objects text[] := array[]::text[];
  candidate text;
begin
  foreach candidate in array array[
    'public.ledger_accounts',
    'public.ledger_transactions',
    'public.ledger_journal_entries',
    'public.ledger_links'
  ] loop
    if to_regclass(candidate) is not null then
      found_objects := found_objects || ('table ' || candidate);
    end if;
  end loop;

  foreach candidate in array array[
    'resolve_ledger_account',
    'post_ledger_transaction',
    'assert_ledger_transaction_balanced'
  ] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = candidate
    ) then
      found_objects := found_objects || ('function public.' || candidate);
    end if;
  end loop;

  if array_length(found_objects, 1) is not null then
    raise exception
      'Ledger journal migration is a first-deployment migration, but these objects already exist: %. Inspect the installed schema and decide deliberately; do not weaken the CREATE statements.',
      array_to_string(found_objects, ', ');
  end if;
end
$existing_objects$;

/* ══ 0b. Dependency preflight ═══════════════════════════════════════════════ */

do $dependencies$
declare
  v_major integer;
begin
  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception
      'Ledger journal migration requires gen_random_uuid(). It is built in from PostgreSQL 13 and provided by pgcrypto before that. This migration deliberately does not create extensions.';
  end if;

  select (current_setting('server_version_num')::integer / 10000) into v_major;
  if v_major < 12 then
    raise exception
      'Ledger journal migration requires PostgreSQL 12 or newer for the deferred constraint trigger used to enforce balance; server reports major version %',
      v_major;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pg_catalog' and p.proname = 'jsonb_array_elements'
  ) then
    raise exception 'Ledger journal migration requires jsonb_array_elements()';
  end if;
end
$dependencies$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Ledger journal migration requires the service_role role';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'Ledger journal migration requires the anon role to revoke from';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'Ledger journal migration requires the authenticated role to revoke from';
  end if;
end
$roles$;

/* ══ 0c. External schema preflight ════════════════════════════════════════════════ */

-- Posting validates payment and payment-event links. Fail before the first
-- CREATE TABLE when the repository's pre-existing lifecycle schema is not the
-- exact shape those checks require.
do $external_schema$
begin
  if to_regclass('public.payments') is null then
    raise exception 'Ledger journal migration requires table public.payments';
  end if;
  if to_regclass('public.payment_events') is null then
    raise exception 'Ledger journal migration requires table public.payment_events';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name in ('id', 'merchant_id')
       and data_type = 'uuid'
     group by table_name having count(distinct column_name) = 2
  ) then
    raise exception 'Ledger journal migration requires payments.id and payments.merchant_id to be uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_events'
       and column_name in ('id', 'payment_id')
       and data_type = 'uuid'
     group by table_name having count(distinct column_name) = 2
  ) then
    raise exception 'Ledger journal migration requires payment_events.id and payment_events.payment_id to be uuid';
  end if;
end
$external_schema$;

/* ══ 1. ledger_accounts ═════════════════════════════════════════════════════ */

-- A named account. Ownership is generic: a merchant, the PineTree platform, a
-- provider clearing position, or an adjustment/suspense bucket.
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),

  owner_type text not null,
  /* Stable identifier. Text rather than uuid so a provider or platform account
     can be keyed by a controlled slug that is not a merchant id. */
  owner_id text not null,
  account_type text not null,

  currency_or_asset text not null,
  /* Normalized to '' rather than null so the uniqueness key is total: two rows
     differing only by null network would otherwise both be permitted. */
  network text not null default '',

  /* Denomination the balance is carried in, per Standard 03 section 1. */
  unit text not null,
  precision integer not null,

  status text not null default 'active',
  created_at timestamptz not null default now(),

  constraint ledger_accounts_owner_type_check
    check (owner_type in ('merchant', 'platform', 'provider', 'system')),

  constraint ledger_accounts_account_type_check
    check (account_type in (
      'provider_clearing',
      'merchant_receivable',
      'merchant_payable',
      'platform_fee_receivable',
      'provider_fee_expense',
      'refund_obligation',
      'adjustment_suspense'
    )),

  constraint ledger_accounts_currency_check
    check (currency_or_asset ~ '^[A-Z0-9]{2,12}$'),

  constraint ledger_accounts_precision_check
    check (precision >= 0 and precision <= 18),

  constraint ledger_accounts_status_check
    check (status in ('active', 'closed'))
);

-- Account identity. Network participates, normalized to '' when absent.
create unique index ledger_accounts_identity_uidx
  on public.ledger_accounts (owner_type, owner_id, account_type, currency_or_asset, network);

create index ledger_accounts_owner_idx
  on public.ledger_accounts (owner_type, owner_id);

comment on table public.ledger_accounts is
  'Named accounts for the PineTree balanced journal. Generic across every payment rail; no provider is privileged here.';

/* ══ 2. ledger_transactions ═════════════════════════════════════════════════ */

-- One economic event, or one correction of one.
create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),

  /* Deterministic and unique. This is what makes posting exactly-once: a
     duplicate live response, invoice lookup, or recovery pass all derive the
     same key and resolve to the same transaction. */
  posting_key text not null,
  posting_version text not null,

  event_type text not null,
  lifecycle_domain text not null,

  business_date date not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  source text not null,

  merchant_id uuid,
  currency_or_asset text not null,
  network text not null default '',
  pricing_version text,

  /* Corrections never edit history; they point back at what they reverse. */
  reversal_of_transaction_id uuid
    references public.ledger_transactions (id) on delete restrict,

  created_at timestamptz not null default now(),

  constraint ledger_transactions_posting_key_check
    check (length(btrim(posting_key)) > 0),

  constraint ledger_transactions_lifecycle_domain_check
    check (lifecycle_domain in (
      'payment', 'refund', 'withdrawal', 'settlement', 'fee', 'adjustment'
    )),

  constraint ledger_transactions_currency_check
    check (currency_or_asset ~ '^[A-Z0-9]{2,12}$'),

  constraint ledger_transactions_not_self_reversing_check
    check (reversal_of_transaction_id is null or reversal_of_transaction_id <> id)
);

create unique index ledger_transactions_posting_key_uidx
  on public.ledger_transactions (posting_key);

create index ledger_transactions_merchant_date_idx
  on public.ledger_transactions (merchant_id, business_date desc);

create index ledger_transactions_reversal_idx
  on public.ledger_transactions (reversal_of_transaction_id)
  where reversal_of_transaction_id is not null;

comment on column public.ledger_transactions.posting_key is
  'Deterministic exactly-once key, unique platform-wide. Format: <domain>.<event>.<version>|<merchant_id>|<record_id>. A duplicate live response, lookup, or recovery pass derives the same key and resolves to the same transaction.';

/* ══ 3. ledger_journal_entries ══════════════════════════════════════════════ */

-- The debit/credit lines. Named `ledger_journal_entries` because
-- `ledger_entries` is the pre-existing legacy table this journal will
-- eventually replace. See the ADR.
create table public.ledger_journal_entries (
  id uuid primary key default gen_random_uuid(),

  ledger_transaction_id uuid not null
    references public.ledger_transactions (id) on delete restrict,
  account_id uuid not null
    references public.ledger_accounts (id) on delete restrict,

  line_number integer not null,
  side text not null,
  /* Strictly positive. Direction is carried by `side`, never by a sign, so a
     negative credit can never masquerade as a debit. */
  amount_minor bigint not null,
  currency_or_asset text not null,
  network text not null default '',
  memo text,
  created_at timestamptz not null default now(),

  constraint ledger_journal_entries_side_check
    check (side in ('debit', 'credit')),
  constraint ledger_journal_entries_amount_check
    check (amount_minor > 0),
  constraint ledger_journal_entries_line_number_check
    check (line_number >= 1),
  constraint ledger_journal_entries_currency_check
    check (currency_or_asset ~ '^[A-Z0-9]{2,12}$')
);

create unique index ledger_journal_entries_line_uidx
  on public.ledger_journal_entries (ledger_transaction_id, line_number);

create index ledger_journal_entries_transaction_idx
  on public.ledger_journal_entries (ledger_transaction_id);

create index ledger_journal_entries_account_idx
  on public.ledger_journal_entries (account_id, created_at desc);

/* ══ 4. ledger_links ════════════════════════════════════════════════════════ */

-- Every posting is tied to the lifecycle record it accounts for. No orphans.
create table public.ledger_links (
  id uuid primary key default gen_random_uuid(),

  ledger_transaction_id uuid not null
    references public.ledger_transactions (id) on delete restrict,
  merchant_id uuid not null,

  link_type text not null,
  record_id text not null,

  payment_id uuid,
  payment_attempt_id text,
  payment_event_id uuid,

  created_at timestamptz not null default now(),

  constraint ledger_links_link_type_check
    check (link_type in (
      'payment', 'payment_attempt', 'payment_event',
      'refund', 'withdrawal', 'settlement', 'adjustment'
    )),
  constraint ledger_links_record_id_check
    check (length(btrim(record_id)) > 0)
);

create unique index ledger_links_identity_uidx
  on public.ledger_links (ledger_transaction_id, link_type, record_id);

create index ledger_links_payment_idx
  on public.ledger_links (payment_id) where payment_id is not null;

create index ledger_links_merchant_idx
  on public.ledger_links (merchant_id, created_at desc);

/* ══ 5. Immutability ════════════════════════════════════════════════════════ */

-- Financial history is append-only. Corrections create a NEW reversing
-- transaction; nothing rewrites what already posted.
--
-- Enforced by trigger rather than by privilege alone, so it holds even for a
-- SECURITY DEFINER function running as the table owner.
create function public.ledger_history_is_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception
    'Ledger history is append-only: % on % is not permitted. Post a reversing transaction instead.',
    tg_op, tg_table_name;
end
$function$;

create trigger ledger_transactions_immutable
  before update or delete on public.ledger_transactions
  for each row execute function public.ledger_history_is_immutable();

-- An account's FINANCIAL IDENTITY is immutable: changing the currency or owner
-- of an account would silently restate every posting ever made against it. Only
-- a controlled status change is permitted.
create function public.ledger_account_identity_is_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.owner_type is distinct from old.owner_type
     or new.owner_id is distinct from old.owner_id
     or new.account_type is distinct from old.account_type
     or new.currency_or_asset is distinct from old.currency_or_asset
     or new.network is distinct from old.network
     or new.unit is distinct from old.unit
     or new.precision is distinct from old.precision then
    raise exception
      'Ledger account financial identity is immutable; only status may change.';
  end if;
  return new;
end
$function$;

create trigger ledger_accounts_identity_immutable
  before update on public.ledger_accounts
  for each row execute function public.ledger_account_identity_is_immutable();

create trigger ledger_accounts_undeletable
  before delete on public.ledger_accounts
  for each row execute function public.ledger_history_is_immutable();

create trigger ledger_journal_entries_immutable
  before update or delete on public.ledger_journal_entries
  for each row execute function public.ledger_history_is_immutable();

create trigger ledger_links_immutable
  before update or delete on public.ledger_links
  for each row execute function public.ledger_history_is_immutable();

/* ══ 6. Balance enforcement ═════════════════════════════════════════════════ */

-- Debits must equal credits, PER CURRENCY, for every transaction.
--
-- A DEFERRABLE INITIALLY DEFERRED constraint trigger, so the check runs at
-- COMMIT once the whole line set exists. Checking per-row would fail on the
-- first line of every legitimate posting.
--
-- This aggregates WITHOUT any locking clause. PostgreSQL does not permit
-- FOR UPDATE/FOR SHARE with aggregate functions, and the rows are already
-- protected here: they were inserted by this transaction and are immutable.
create function public.assert_ledger_transaction_balanced()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_unbalanced record;
  v_line_count integer;
begin
  select count(*) into v_line_count
    from public.ledger_journal_entries e
   where e.ledger_transaction_id = new.ledger_transaction_id;

  if v_line_count < 2 then
    raise exception
      'Ledger transaction % must have at least two entries to balance; found %',
      new.ledger_transaction_id, v_line_count;
  end if;

  -- Mixed currencies cannot balance against each other: the sum is taken PER
  -- currency, so a debit in USD and a credit in EUR leaves both unbalanced.
  for v_unbalanced in
    select e.currency_or_asset,
           coalesce(sum(e.amount_minor) filter (where e.side = 'debit'), 0) as debits,
           coalesce(sum(e.amount_minor) filter (where e.side = 'credit'), 0) as credits
      from public.ledger_journal_entries e
     where e.ledger_transaction_id = new.ledger_transaction_id
     group by e.currency_or_asset
    having coalesce(sum(e.amount_minor) filter (where e.side = 'debit'), 0)
        <> coalesce(sum(e.amount_minor) filter (where e.side = 'credit'), 0)
  loop
    raise exception
      'Ledger transaction % is unbalanced in %: debits % <> credits %',
      new.ledger_transaction_id, v_unbalanced.currency_or_asset,
      v_unbalanced.debits, v_unbalanced.credits;
  end loop;

  return null;
end
$function$;

create constraint trigger ledger_journal_entries_balanced
  after insert on public.ledger_journal_entries
  deferrable initially deferred
  for each row execute function public.assert_ledger_transaction_balanced();

/* ══ 7. Account resolution ══════════════════════════════════════════════════ */

-- Find or create an account. Idempotent under concurrency: the unique index is
-- the authority and a losing race re-reads rather than failing.
create function public.resolve_ledger_account(
  p_owner_type text,
  p_owner_id text,
  p_account_type text,
  p_currency_or_asset text,
  p_network text default '',
  p_unit text default 'minor',
  p_precision integer default 2
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_id uuid;
  v_network text := coalesce(nullif(btrim(p_network), ''), '');
  v_currency text := upper(btrim(p_currency_or_asset));
  v_violated_constraint text;
  v_existing public.ledger_accounts%rowtype;
begin
  select * into v_existing
    from public.ledger_accounts a
   where a.owner_type = p_owner_type
     and a.owner_id = p_owner_id
     and a.account_type = p_account_type
     and a.currency_or_asset = v_currency
     and a.network = v_network;

  if found then
    if v_existing.status <> 'active' then
      raise exception 'Ledger account % is %', v_existing.id, v_existing.status;
    end if;
    if v_existing.unit is distinct from p_unit
       or v_existing.precision is distinct from p_precision then
      raise exception
        'Ledger account % has unit/precision %/% but %/% was requested',
        v_existing.id, v_existing.unit, v_existing.precision, p_unit, p_precision;
    end if;
    return v_existing.id;
  end if;

  begin
    insert into public.ledger_accounts (
      owner_type, owner_id, account_type, currency_or_asset, network, unit, precision
    ) values (
      p_owner_type, p_owner_id, p_account_type, v_currency, v_network, p_unit, p_precision
    )
    returning id into v_id;
  exception
    when unique_violation then
      -- Only the identity index means "someone else created the same account".
      -- Any other unique violation is a different fault and must not be
      -- swallowed into a silent account lookup.
      get stacked diagnostics v_violated_constraint = constraint_name;
      if v_violated_constraint <> 'ledger_accounts_identity_uidx' then
        raise;
      end if;

       select * into v_existing
         from public.ledger_accounts a
       where a.owner_type = p_owner_type
         and a.owner_id = p_owner_id
         and a.account_type = p_account_type
         and a.currency_or_asset = v_currency
         and a.network = v_network;

       if not found then
         raise exception
           'Ledger account identity conflicted but the account is not visible';
       end if;

       if v_existing.status <> 'active' then
         raise exception 'Ledger account % is %', v_existing.id, v_existing.status;
       end if;
       if v_existing.unit is distinct from p_unit
          or v_existing.precision is distinct from p_precision then
         raise exception
           'Ledger account % has unit/precision %/% but %/% was requested',
           v_existing.id, v_existing.unit, v_existing.precision, p_unit, p_precision;
       end if;
       v_id := v_existing.id;
  end;

  return v_id;
end
$function$;

/* ══ 8. Atomic posting ══════════════════════════════════════════════════════ */

-- Post one balanced journal transaction, exactly once.
--
-- Callable from another PL/pgSQL function in the SAME transaction, which is how
-- a Shift4 capture posts its money and transitions its payment atomically.
--
-- Lines arrive as a jsonb array so the whole set is validated before anything
-- is written:
--   [{"account_id": "...", "side": "debit", "amount_minor": 12345, "memo": "..."}]
--
-- Returns the transaction id and whether it was created now. A duplicate
-- posting key returns the EXISTING transaction and created = false, so a
-- duplicate live response, invoice lookup, and recovery pass all collapse.
create function public.post_ledger_transaction(
  p_posting_key text,
  p_posting_version text,
  p_event_type text,
  p_lifecycle_domain text,
  p_merchant_id uuid,
  p_currency_or_asset text,
  p_lines jsonb,
  p_links jsonb default '[]'::jsonb,
  p_network text default '',
  p_business_date date default null,
  p_occurred_at timestamptz default null,
  p_source text default 'engine',
  p_pricing_version text default null,
  p_reversal_of_transaction_id uuid default null,
  p_unit text default 'minor',
  p_precision integer default 2
)
returns table (
  ledger_transaction_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_existing public.ledger_transactions%rowtype;
  v_id uuid;
  v_line jsonb;
  v_link jsonb;
  v_index integer := 0;
  v_currency text := upper(btrim(p_currency_or_asset));
  v_network text := coalesce(nullif(btrim(p_network), ''), '');
  v_debits bigint := 0;
  v_credits bigint := 0;
  v_amount bigint;
  v_payment_link text;
  v_link_merchant uuid;
  v_existing_identity jsonb;
  v_requested_identity jsonb;
  v_account public.ledger_accounts%rowtype;
begin
  if p_posting_key is null or length(btrim(p_posting_key)) = 0 then
    raise exception 'A posting key is required';
  end if;

  /* ── Lifecycle links are mandatory for money ───────────────────────────── */
  -- "No orphan financial posting" has to be enforced, not merely asserted. A
  -- payment or fee posting with no payment link is unattributable money.
  if p_lifecycle_domain in ('payment', 'fee') then
    if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(coalesce(p_links, '[]'::jsonb)) = 0 then
      raise exception
        'A % posting requires at least one lifecycle link', p_lifecycle_domain;
    end if;

    select v_link ->> 'payment_id' into v_payment_link
      from jsonb_array_elements(p_links) as v_link
     where v_link ->> 'link_type' = 'payment'
       and coalesce(v_link ->> 'payment_id', '') <> ''
     limit 1;

    if v_payment_link is null then
      raise exception
        'A % posting requires a payment link carrying payment_id', p_lifecycle_domain;
    end if;

    -- The payment must exist AND belong to the merchant being posted for.
    select p.merchant_id into v_link_merchant
      from public.payments p
     where p.id = v_payment_link::uuid;

    if not found then
      raise exception 'Lifecycle link references payment %, which does not exist', v_payment_link;
    end if;
    if v_link_merchant is distinct from p_merchant_id then
      raise exception
        'Lifecycle link references payment % belonging to another merchant', v_payment_link;
    end if;

    -- Every payment link in the set must name that same payment: a posting may
    -- not straddle two payments.
    if exists (
      select 1 from jsonb_array_elements(p_links) as l
       where l ->> 'link_type' = 'payment'
         and coalesce(l ->> 'payment_id', '') <> v_payment_link
    ) then
      raise exception 'A single posting may not link to more than one payment';
    end if;

    -- Any payment_event link must belong to the same payment.
    if exists (
      select 1
        from jsonb_array_elements(p_links) as l
        join public.payment_events e
          on e.id = nullif(l ->> 'payment_event_id', '')::uuid
       where coalesce(l ->> 'payment_event_id', '') <> ''
         and e.payment_id <> v_payment_link::uuid
    ) then
      raise exception 'A payment-event link must belong to the linked payment';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(p_links) as l
       where coalesce(l ->> 'payment_event_id', '') <> ''
         and not exists (
           select 1 from public.payment_events e
            where e.id = (l ->> 'payment_event_id')::uuid
         )
    ) then
      raise exception 'A payment-event link references an event that does not exist';
    end if;
  end if;

  /* ── Validate the complete line set BEFORE writing ─────────────────────── */
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal transaction requires at least two entry lines';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_amount := (v_line ->> 'amount_minor')::bigint;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Journal entry amounts must be positive integers; got %', v_amount;
    end if;
    if (v_line ->> 'side') = 'debit' then
      v_debits := v_debits + v_amount;
    elsif (v_line ->> 'side') = 'credit' then
      v_credits := v_credits + v_amount;
    else
      raise exception 'Journal entry side must be debit or credit; got %', v_line ->> 'side';
    end if;

    /* ── The account must actually match this transaction ────────────────── */
    -- A UUID that merely exists is not enough: posting USD lines to a CAD
    -- account, or to a closed one, would balance arithmetically and be wrong.
    select * into v_account
      from public.ledger_accounts a
     where a.id = (v_line ->> 'account_id')::uuid;

    if not found then
      raise exception 'Journal entry references account %, which does not exist',
        v_line ->> 'account_id';
    end if;
    if v_account.status <> 'active' then
      raise exception 'Journal entry references account %, which is %',
        v_account.id, v_account.status;
    end if;
    if v_account.currency_or_asset <> v_currency then
      raise exception
        'Journal entry account % is denominated in % but the transaction is in %',
        v_account.id, v_account.currency_or_asset, v_currency;
    end if;
    if v_account.network is distinct from v_network then
      raise exception
        'Journal entry account % is on network % but the transaction is on %',
        v_account.id, coalesce(nullif(v_account.network, ''), '(none)'),
         coalesce(nullif(v_network, ''), '(none)');
    end if;
    if v_account.unit is distinct from p_unit
       or v_account.precision is distinct from p_precision then
      raise exception
        'Journal entry account % has unit/precision %/% but the transaction requires %/%',
        v_account.id, v_account.unit, v_account.precision, p_unit, p_precision;
    end if;
  end loop;

  if v_debits <> v_credits then
    raise exception
      'Journal transaction is unbalanced: debits % <> credits %', v_debits, v_credits;
  end if;

  /* ── Exactly-once, insert-first ────────────────────────────────────────── */
  -- Deliberately NOT select-then-insert. Two concurrent callers with the same
  -- posting key would both find nothing, both insert, and one would surface a
  -- raw unique_violation instead of the idempotent resume the caller expects.
  -- The unique index decides; the loser reads the winner's row and compares.
  begin
    insert into public.ledger_transactions (
      posting_key, posting_version, event_type, lifecycle_domain,
      business_date, occurred_at, received_at, source,
      merchant_id, currency_or_asset, network, pricing_version,
      reversal_of_transaction_id
    ) values (
      p_posting_key, p_posting_version, p_event_type, p_lifecycle_domain,
      coalesce(p_business_date, (coalesce(p_occurred_at, now()) at time zone 'utc')::date),
      p_occurred_at, now(), p_source,
      p_merchant_id, v_currency, v_network, p_pricing_version,
      p_reversal_of_transaction_id
    )
    returning id into v_id;
  exception
    when unique_violation then
      -- Someone else won. Lock their row and compare the FULL financial
      -- identity before treating this as an idempotent replay.
      select * into v_existing
        from public.ledger_transactions t
       where t.posting_key = p_posting_key
         for update;

      if not found then
        raise exception
          'Posting key % conflicted but its transaction is not visible', p_posting_key;
      end if;

      if v_existing.posting_version is distinct from p_posting_version
         or v_existing.event_type is distinct from p_event_type
         or v_existing.lifecycle_domain is distinct from p_lifecycle_domain
         or v_existing.merchant_id is distinct from p_merchant_id
         or v_existing.currency_or_asset is distinct from v_currency
         or v_existing.network is distinct from v_network
         or v_existing.pricing_version is distinct from p_pricing_version
         or v_existing.reversal_of_transaction_id
            is distinct from p_reversal_of_transaction_id then
        raise exception
          'Posting key % was already used for a different economic event', p_posting_key;
      end if;

      -- Compare the stored LINES against the requested set, normalized and
      -- ordered deterministically. A caller-supplied fingerprint is never
      -- trusted; the underlying content is recomputed here.
      select coalesce(jsonb_agg(line order by line), '[]'::jsonb) into v_existing_identity
        from (
          select jsonb_build_object(
                   'account_id', e.account_id,
                   'side', e.side,
                   'amount_minor', e.amount_minor,
                   'memo', coalesce(e.memo, '')
                 ) as line
            from public.ledger_journal_entries e
           where e.ledger_transaction_id = v_existing.id
        ) existing_lines;

      select coalesce(jsonb_agg(line order by line), '[]'::jsonb) into v_requested_identity
        from (
          select jsonb_build_object(
                   'account_id', (l ->> 'account_id')::uuid,
                   'side', l ->> 'side',
                   'amount_minor', (l ->> 'amount_minor')::bigint,
                   'memo', coalesce(l ->> 'memo', '')
                 ) as line
            from jsonb_array_elements(p_lines) as l
        ) requested_lines;

      if v_existing_identity is distinct from v_requested_identity then
        raise exception
          'Posting key % was already used with different journal lines', p_posting_key;
      end if;

      -- ...and the links.
      select coalesce(jsonb_agg(link order by link), '[]'::jsonb) into v_existing_identity
        from (
          select jsonb_build_object(
                   'link_type', k.link_type,
                   'record_id', k.record_id,
                   'payment_id', coalesce(k.payment_id::text, ''),
                   'payment_attempt_id', coalesce(k.payment_attempt_id, ''),
                   'payment_event_id', coalesce(k.payment_event_id::text, '')
                 ) as link
            from public.ledger_links k
           where k.ledger_transaction_id = v_existing.id
        ) existing_links;

      select coalesce(jsonb_agg(link order by link), '[]'::jsonb) into v_requested_identity
        from (
          select jsonb_build_object(
                   'link_type', l ->> 'link_type',
                   'record_id', l ->> 'record_id',
                   'payment_id', coalesce(l ->> 'payment_id', ''),
                   'payment_attempt_id', coalesce(l ->> 'payment_attempt_id', ''),
                   'payment_event_id', coalesce(l ->> 'payment_event_id', '')
                 ) as link
            from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as l
        ) requested_links;

      if v_existing_identity is distinct from v_requested_identity then
        raise exception
          'Posting key % was already used with different lifecycle links', p_posting_key;
      end if;

      -- Identical in every financial respect: an honest idempotent replay.
      return query select v_existing.id, false;
      return;
  end;

  /* ── Write the lines ───────────────────────────────────────────────────── */
  -- The transaction row was inserted above; reaching here means this caller won
  -- the posting-key race and owns the write.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    insert into public.ledger_journal_entries (
      ledger_transaction_id, account_id, line_number, side,
      amount_minor, currency_or_asset, network, memo
    ) values (
      v_id,
      (v_line ->> 'account_id')::uuid,
      v_index,
      v_line ->> 'side',
      (v_line ->> 'amount_minor')::bigint,
      v_currency,
      v_network,
      v_line ->> 'memo'
    );
  end loop;

  for v_link in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    insert into public.ledger_links (
      ledger_transaction_id, merchant_id, link_type, record_id,
      payment_id, payment_attempt_id, payment_event_id
    ) values (
      v_id,
      p_merchant_id,
      v_link ->> 'link_type',
      v_link ->> 'record_id',
      nullif(v_link ->> 'payment_id', '')::uuid,
      nullif(v_link ->> 'payment_attempt_id', ''),
      nullif(v_link ->> 'payment_event_id', '')::uuid
    );
  end loop;

  return query select v_id, true;
end
$function$;

/* ══ 9. Row-level security and privileges ═══════════════════════════════════ */

alter table public.ledger_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_journal_entries enable row level security;
alter table public.ledger_links enable row level security;

-- Total lockdown, matching merchant_providers and shift4_payment_attempts: RLS
-- on, NO policy created, so anon and authenticated reach nothing. service_role
-- is revoked first, because Supabase default privileges commonly grant it
-- everything on new tables in `public`, and then granted back only SELECT.
--
-- No role receives INSERT, UPDATE, or DELETE on any journal table. Every write
-- goes through post_ledger_transaction, which runs as this migration's owner.
-- That is what makes "append-only" true rather than merely intended.
revoke all on public.ledger_accounts from public, anon, authenticated, service_role;
revoke all on public.ledger_transactions from public, anon, authenticated, service_role;
revoke all on public.ledger_journal_entries from public, anon, authenticated, service_role;
revoke all on public.ledger_links from public, anon, authenticated, service_role;

grant select on public.ledger_accounts to service_role;
grant select on public.ledger_transactions to service_role;
grant select on public.ledger_journal_entries to service_role;
grant select on public.ledger_links to service_role;

revoke all on function public.ledger_history_is_immutable() from public, anon, authenticated, service_role;
revoke all on function public.ledger_account_identity_is_immutable() from public, anon, authenticated, service_role;
revoke all on function public.assert_ledger_transaction_balanced() from public, anon, authenticated, service_role;
revoke all on function public.resolve_ledger_account(text, text, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.post_ledger_transaction(
  text, text, text, text, uuid, text, jsonb, jsonb, text, date, timestamptz, text, text, uuid, text, integer
) from public, anon, authenticated;

-- NO role holds EXECUTE on either helper, not even service_role.
--
-- Nothing in TypeScript calls them: an audit of the repository found the only
-- references are string assertions inside the contract tests. Their sole caller
-- is the Shift4 evidence function, which is SECURITY DEFINER and owned by this
-- migration's owner, so it reaches them through shared function ownership and
-- needs no grant. Granting service_role EXECUTE would hand a live posting
-- capability to application credentials for no reason.
--
-- If a direct RPC call is ever genuinely required, add the minimum grant HERE
-- and record the exact call site alongside it.
revoke all on function public.resolve_ledger_account(text, text, text, text, text, text, integer)
  from service_role;
revoke all on function public.post_ledger_transaction(
  text, text, text, text, uuid, text, jsonb, jsonb, text, date, timestamptz, text, text, uuid, text, integer
) from service_role;

notify pgrst, 'reload schema';

commit;
