-- PineTree Payments — Full Schema Migration
-- Run this in Supabase SQL Editor to ensure all tables exist with correct columns.
-- All statements use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — safe to re-run.

-- ─── payments ─────────────────────────────────────────────────────────────────

create table if not exists public.payments (
  id                 uuid         primary key default gen_random_uuid(),
  merchant_id        uuid         not null,
  merchant_amount    numeric      not null default 0,
  pinetree_fee       numeric      not null default 0,
  gross_amount       numeric      not null default 0,
  currency           text         not null default 'USD',
  provider           text         not null,
  provider_reference text,
  network            text,
  payment_url        text,
  qr_code_url        text,
  metadata           jsonb,
  status             text         not null default 'CREATED',
  created_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now()
);

-- Add columns that older tables may be missing
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='payments' and column_name='gross_amount') then
    alter table public.payments add column gross_amount numeric not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='payments' and column_name='merchant_amount') then
    alter table public.payments add column merchant_amount numeric not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='payments' and column_name='pinetree_fee') then
    alter table public.payments add column pinetree_fee numeric not null default 0;
  end if;
end $$;

create index if not exists payments_merchant_id_idx on public.payments (merchant_id);
create index if not exists payments_status_network_idx on public.payments (status, network);
create index if not exists payments_provider_reference_idx on public.payments (provider_reference) where provider_reference is not null;
create index if not exists payments_created_at_idx on public.payments (created_at desc);

-- ─── transactions ─────────────────────────────────────────────────────────────

create table if not exists public.transactions (
  id                      uuid         primary key default gen_random_uuid(),
  payment_id              uuid         references public.payments(id),
  merchant_id             uuid         not null,
  provider                text         not null,
  provider_transaction_id text,
  network                 text,
  channel                 text         default 'pos',
  total_amount            numeric      default 0,
  subtotal_amount         numeric      default 0,
  platform_fee            numeric      default 0,
  status                  text         not null default 'PENDING',
  created_at              timestamptz  not null default now(),
  updated_at              timestamptz  not null default now()
);

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='merchant_id') then
    alter table public.transactions add column merchant_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='channel') then
    alter table public.transactions add column channel text default 'pos';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='total_amount') then
    alter table public.transactions add column total_amount numeric default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='subtotal_amount') then
    alter table public.transactions add column subtotal_amount numeric default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='platform_fee') then
    alter table public.transactions add column platform_fee numeric default 0;
  end if;
end $$;

create index if not exists transactions_merchant_id_idx on public.transactions (merchant_id);
create index if not exists transactions_payment_id_idx on public.transactions (payment_id);
create index if not exists transactions_created_at_idx on public.transactions (created_at desc);

-- ─── payment_events ───────────────────────────────────────────────────────────

create table if not exists public.payment_events (
  id             uuid         primary key default gen_random_uuid(),
  payment_id     uuid         not null references public.payments(id),
  event_type     text         not null,
  provider_event text,
  raw_payload    jsonb,
  created_at     timestamptz  not null default now()
);

create index if not exists payment_events_payment_id_created_at_idx on public.payment_events (payment_id, created_at desc);

-- ─── payment_intents ──────────────────────────────────────────────────────────

create table if not exists public.payment_intents (
  id                  uuid         primary key default gen_random_uuid(),
  merchant_id         uuid         not null,
  amount              numeric      not null,
  currency            text         not null default 'USD',
  terminal_id         uuid,
  pinetree_fee        numeric      not null default 0,
  metadata            jsonb,
  available_networks  jsonb,
  selected_network    text,
  payment_id          uuid         references public.payments(id),
  status              text         not null default 'CREATED',
  expires_at          timestamptz,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now()
);

create index if not exists payment_intents_merchant_id_idx on public.payment_intents (merchant_id);
create index if not exists payment_intents_status_idx on public.payment_intents (status);
create index if not exists payment_intents_expires_at_idx on public.payment_intents (expires_at);

-- ─── ledger_entries ───────────────────────────────────────────────────────────

create table if not exists public.ledger_entries (
  id             uuid         primary key default gen_random_uuid(),
  merchant_id    uuid,
  payment_id     uuid,
  transaction_id uuid,
  provider       text,
  network        text,
  asset          text,
  amount         numeric,
  usd_value      numeric,
  wallet_address text,
  direction      text,
  status         text,
  created_at     timestamptz  not null default now()
);

-- Unique constraint: only one ledger entry per payment (idempotency)
create unique index if not exists ledger_entries_payment_id_unique_idx
  on public.ledger_entries (payment_id)
  where payment_id is not null;

create index if not exists ledger_entries_merchant_id_idx on public.ledger_entries (merchant_id);
create index if not exists ledger_entries_created_at_idx on public.ledger_entries (created_at desc);

-- ─── idempotency_keys ─────────────────────────────────────────────────────────

create table if not exists public.idempotency_keys (
  key        text         primary key,
  payment_id uuid         not null,
  status     text         not null default 'claimed',
  created_at timestamptz  not null default now()
);

-- ─── merchants ────────────────────────────────────────────────────────────────

create table if not exists public.merchants (
  id         uuid         primary key,
  email      text,
  name       text,
  created_at timestamptz  not null default now(),
  updated_at timestamptz  not null default now()
);

-- ─── merchant_wallets ─────────────────────────────────────────────────────────

create table if not exists public.merchant_wallets (
  id             uuid         primary key default gen_random_uuid(),
  merchant_id    uuid         not null,
  wallet_address text         not null,
  network        text         not null,
  label          text,
  priority       int          not null default 0,
  is_active      boolean      not null default true,
  created_at     timestamptz  not null default now()
);

-- Add missing columns to existing merchant_wallets table
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='merchant_wallets' and column_name='is_active') then
    alter table public.merchant_wallets add column is_active boolean not null default true;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='merchant_wallets' and column_name='priority') then
    alter table public.merchant_wallets add column priority int not null default 0;
  end if;
end $$;

create index if not exists merchant_wallets_merchant_id_idx on public.merchant_wallets (merchant_id);
create index if not exists merchant_wallets_network_idx on public.merchant_wallets (merchant_id, network);

-- ─── merchant_providers ───────────────────────────────────────────────────────

create table if not exists public.merchant_providers (
  id          uuid         primary key default gen_random_uuid(),
  merchant_id uuid         not null,
  provider    text         not null,
  status      text         not null default 'connected',
  created_at  timestamptz  not null default now()
);

create index if not exists merchant_providers_merchant_id_idx on public.merchant_providers (merchant_id);

-- ─── merchant_credentials ─────────────────────────────────────────────────────

create table if not exists public.merchant_credentials (
  id             uuid         primary key default gen_random_uuid(),
  merchant_id    uuid         not null,
  credential_key text         not null,
  credential_value text       not null,
  created_at     timestamptz  not null default now(),
  constraint merchant_credentials_unique unique (merchant_id, credential_key)
);

-- ─── merchant_tax_settings ────────────────────────────────────────────────────

create table if not exists public.merchant_tax_settings (
  id          uuid         primary key default gen_random_uuid(),
  merchant_id uuid         not null unique,
  tax_enabled boolean      not null default false,
  tax_rate    numeric      not null default 0,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);

-- ─── merchant_settings ────────────────────────────────────────────────────────

create table if not exists public.merchant_settings (
  id          uuid         primary key default gen_random_uuid(),
  merchant_id uuid         not null unique,
  settings    jsonb        not null default '{}',
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);

-- ─── wallet_balances ──────────────────────────────────────────────────────────

create table if not exists public.wallet_balances (
  id             uuid         primary key default gen_random_uuid(),
  merchant_id    uuid         not null,
  wallet_address text         not null,
  network        text         not null,
  asset          text         not null,
  balance        numeric      not null default 0,
  usd_value      numeric      not null default 0,
  last_updated   timestamptz  not null default now(),
  constraint wallet_balances_unique unique (merchant_id, wallet_address, asset)
);

create index if not exists wallet_balances_merchant_id_idx on public.wallet_balances (merchant_id);

-- ─── routing_rules ────────────────────────────────────────────────────────────

create table if not exists public.routing_rules (
  id          uuid         primary key default gen_random_uuid(),
  merchant_id uuid         not null,
  network     text,
  provider    text,
  priority    int          not null default 0,
  is_active   boolean      not null default true,
  created_at  timestamptz  not null default now()
);

-- ─── terminals ────────────────────────────────────────────────────────────────

create table if not exists public.terminals (
  id          uuid         primary key default gen_random_uuid(),
  merchant_id uuid         not null,
  label       text,
  location    text,
  is_active   boolean      not null default true,
  created_at  timestamptz  not null default now()
);

-- ─── cash_drawer_log ──────────────────────────────────────────────────────────

create table if not exists public.cash_drawer_log (
  id              uuid         primary key default gen_random_uuid(),
  terminal_id     uuid,
  merchant_id     uuid         not null,
  type            text         not null,
  amount          numeric      not null default 0,
  running_balance numeric      not null default 0,
  sale_total      numeric,
  cash_tendered   numeric,
  change_given    numeric,
  actual_amount   numeric,
  notes           text,
  created_at      timestamptz  not null default now()
);

create index if not exists cash_drawer_log_terminal_id_idx on public.cash_drawer_log (terminal_id);
create index if not exists cash_drawer_log_created_at_idx on public.cash_drawer_log (created_at desc);

-- ─── RLS policies ─────────────────────────────────────────────────────────────
-- Enable RLS on all tables so authenticated merchants only see their own data

alter table public.payments          enable row level security;
alter table public.transactions      enable row level security;
alter table public.payment_events    enable row level security;
alter table public.payment_intents   enable row level security;
alter table public.ledger_entries    enable row level security;
alter table public.merchant_wallets  enable row level security;
alter table public.wallet_balances   enable row level security;
alter table public.cash_drawer_log   enable row level security;

-- Payments RLS
drop policy if exists "Merchants see own payments" on public.payments;
create policy "Merchants see own payments"
  on public.payments for all
  using (merchant_id = auth.uid());

-- Transactions RLS
drop policy if exists "Merchants see own transactions" on public.transactions;
create policy "Merchants see own transactions"
  on public.transactions for all
  using (merchant_id = auth.uid());

-- Payment intents RLS (merchant_id is text in existing table, cast uid to text)
drop policy if exists "Merchants see own intents" on public.payment_intents;
create policy "Merchants see own intents"
  on public.payment_intents for all
  using (merchant_id = auth.uid()::text);

-- Payment events RLS (via payment)
drop policy if exists "Merchants see own payment events" on public.payment_events;
create policy "Merchants see own payment events"
  on public.payment_events for all
  using (
    payment_id in (
      select id from public.payments where merchant_id = auth.uid()
    )
  );

-- Ledger entries RLS
drop policy if exists "Merchants see own ledger" on public.ledger_entries;
create policy "Merchants see own ledger"
  on public.ledger_entries for all
  using (merchant_id = auth.uid());

-- Merchant wallets RLS
drop policy if exists "Merchants see own wallets" on public.merchant_wallets;
create policy "Merchants see own wallets"
  on public.merchant_wallets for all
  using (merchant_id = auth.uid());

-- Wallet balances RLS
drop policy if exists "Merchants see own balances" on public.wallet_balances;
create policy "Merchants see own balances"
  on public.wallet_balances for all
  using (merchant_id = auth.uid());

-- Cash drawer RLS
drop policy if exists "Merchants see own drawer" on public.cash_drawer_log;
create policy "Merchants see own drawer"
  on public.cash_drawer_log for all
  using (merchant_id = auth.uid());

-- Notify PostgREST to reload schema cache
select pg_notify('pgrst', 'reload schema');
