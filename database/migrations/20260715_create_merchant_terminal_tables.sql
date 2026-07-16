-- Stripe Terminal foundation: provider terminal locations and readers.
--
-- PineTree's existing `terminals` table models POS devices (name/PIN/tax
-- config) and `locations` models business locations - neither stores
-- provider card-reader hardware, so two new provider-generalized tables are
-- required. Payments/transactions need NO schema change: card capture
-- metadata (payment_channel, capture_method, terminal_reader_id,
-- card_present, provider_status, failure_code/message) is stored in the
-- payments.metadata JSONB "card" object, following the existing
-- metadata.split convention, and provider_payment_intent_id reuses the
-- existing payments.provider_reference column.
--
-- No reader registration codes, connection-token secrets, PaymentIntent
-- client secrets, or card data are ever stored.
--
-- Idempotent. Applies the service-role-only RLS convention used by
-- merchant_providers / merchant_speed_credentials.

-- ── Terminal locations ────────────────────────────────────────────────────
create table if not exists public.merchant_terminal_locations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  provider text not null default 'stripe',
  provider_location_id text not null,
  display_name text not null,
  address jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists merchant_terminal_locations_provider_uidx
  on public.merchant_terminal_locations (merchant_id, provider, provider_location_id);

-- Composite ownership target used by readers so a reader cannot reference a
-- location belonging to another merchant or provider.
create unique index if not exists merchant_terminal_locations_ownership_uidx
  on public.merchant_terminal_locations (id, merchant_id, provider);

create index if not exists merchant_terminal_locations_merchant_idx
  on public.merchant_terminal_locations (merchant_id);

alter table public.merchant_terminal_locations enable row level security;
revoke all on public.merchant_terminal_locations from anon, authenticated;

comment on table public.merchant_terminal_locations is
  'Provider Terminal locations (e.g. Stripe Terminal Locations) mapped per merchant. Service-role access only; merchants reach their rows through authenticated PineTree API routes.';

-- ── Terminal readers ──────────────────────────────────────────────────────
create table if not exists public.merchant_terminal_readers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  terminal_location_id uuid,
  provider text not null default 'stripe',
  provider_reader_id text not null,
  label text not null default '',
  device_type text not null default '',
  serial_number text,
  status text not null default 'unknown',
  simulated boolean not null default false,
  is_default boolean not null default false,
  -- Concurrency claim: the PineTree payment currently being processed on
  -- this reader. Claimed/released with conditional updates so one reader
  -- never runs two payments and one payment never runs on two readers.
  active_payment_id uuid,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Strengthened ownership constraints. Named/idempotent blocks also upgrade a
-- table created by an earlier revision of this migration.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'merchant_terminal_locations_merchant_id_fkey') then
    alter table public.merchant_terminal_locations
      add constraint merchant_terminal_locations_merchant_id_fkey
      foreign key (merchant_id) references public.merchants(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'merchant_terminal_readers_merchant_id_fkey') then
    alter table public.merchant_terminal_readers
      add constraint merchant_terminal_readers_merchant_id_fkey
      foreign key (merchant_id) references public.merchants(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'merchant_terminal_readers_active_payment_id_fkey') then
    alter table public.merchant_terminal_readers
      add constraint merchant_terminal_readers_active_payment_id_fkey
      foreign key (active_payment_id) references public.payments(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'merchant_terminal_readers_location_owner_fkey') then
    alter table public.merchant_terminal_readers
      add constraint merchant_terminal_readers_location_owner_fkey
      foreign key (terminal_location_id, merchant_id, provider)
      references public.merchant_terminal_locations (id, merchant_id, provider)
      on delete set null (terminal_location_id);
  end if;
end
$$;

create unique index if not exists merchant_terminal_readers_provider_uidx
  on public.merchant_terminal_readers (merchant_id, provider, provider_reader_id);

-- At most one default reader per merchant per provider.
create unique index if not exists merchant_terminal_readers_default_uidx
  on public.merchant_terminal_readers (merchant_id, provider)
  where is_default;

-- A PineTree payment can be claimed by at most one reader at a time.
create unique index if not exists merchant_terminal_readers_active_payment_uidx
  on public.merchant_terminal_readers (active_payment_id)
  where active_payment_id is not null;

create index if not exists merchant_terminal_readers_merchant_idx
  on public.merchant_terminal_readers (merchant_id);

alter table public.merchant_terminal_readers enable row level security;
revoke all on public.merchant_terminal_readers from anon, authenticated;

comment on table public.merchant_terminal_readers is
  'Provider card readers (e.g. Stripe Terminal readers) per merchant, including simulated test readers. Registration codes are never stored. active_payment_id is the single-payment-per-reader concurrency claim. Service-role access only.';
