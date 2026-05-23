-- PineTree Payments - Wallet operation foundation
--
-- Phase 1 only:
-- - Stores wallet/provider operation drafts and audit events.
-- - Grants merchants read-only access to their own wallet operation records.
-- - Leaves all writes to service-role/server code.
-- - Does not call provider withdrawal APIs, send Lightning payments, send
--   Bitcoin on-chain payments, bank payouts, or mark withdrawals completed.

create table if not exists public.wallet_operations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  provider text not null,
  operation_type text not null,
  asset text not null,
  network text not null,
  amount numeric not null,
  destination_type text not null,
  destination_value text null,
  status text not null default 'DRAFT',
  provider_operation_id text null,
  provider_status text null,
  error_code text null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_operations_provider_check
    check (provider in ('speed')),
  constraint wallet_operations_operation_type_check
    check (operation_type in ('WITHDRAWAL_DRAFT')),
  constraint wallet_operations_asset_check
    check (asset in ('BTC')),
  constraint wallet_operations_network_check
    check (network in ('bitcoin_lightning')),
  constraint wallet_operations_destination_type_check
    check (destination_type in ('lightning_invoice', 'bitcoin_address', 'provider_bank_payout')),
  constraint wallet_operations_status_check
    check (status in (
      'CREATED',
      'DRAFT',
      'VALIDATION_FAILED',
      'AWAITING_CONFIRMATION',
      'READY_TO_SUBMIT',
      'SUBMITTED',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    ))
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wallet_operations_id_merchant_id_key'
      and conrelid = 'public.wallet_operations'::regclass
  ) then
    alter table public.wallet_operations
      add constraint wallet_operations_id_merchant_id_key unique (id, merchant_id);
  end if;
end $$;

create table if not exists public.wallet_operation_events (
  id uuid primary key default gen_random_uuid(),
  wallet_operation_id uuid not null,
  merchant_id uuid not null,
  event_type text not null,
  provider text not null,
  provider_event_id text null,
  provider_status text null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint wallet_operation_events_operation_merchant_fk
    foreign key (wallet_operation_id, merchant_id)
    references public.wallet_operations(id, merchant_id)
    on delete cascade,
  constraint wallet_operation_events_provider_check
    check (provider in ('speed'))
);

create index if not exists wallet_operations_merchant_created_at_idx
  on public.wallet_operations (merchant_id, created_at desc);

create index if not exists wallet_operations_merchant_status_idx
  on public.wallet_operations (merchant_id, status);

create index if not exists wallet_operations_provider_operation_idx
  on public.wallet_operations (provider, provider_operation_id);

create index if not exists wallet_operation_events_operation_created_at_idx
  on public.wallet_operation_events (wallet_operation_id, created_at desc);

create index if not exists wallet_operation_events_merchant_created_at_idx
  on public.wallet_operation_events (merchant_id, created_at desc);

alter table public.wallet_operations enable row level security;
alter table public.wallet_operation_events enable row level security;

drop policy if exists "Merchants read own wallet operations" on public.wallet_operations;
create policy "Merchants read own wallet operations"
  on public.wallet_operations for select
  using (merchant_id::text = auth.uid()::text);

drop policy if exists "Merchants read own wallet operation events" on public.wallet_operation_events;
create policy "Merchants read own wallet operation events"
  on public.wallet_operation_events for select
  using (merchant_id::text = auth.uid()::text);

select pg_notify('pgrst', 'reload schema');
