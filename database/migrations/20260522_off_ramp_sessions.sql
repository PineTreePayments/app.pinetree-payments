-- PineTree Payments - Off-ramp session foundation
--
-- Phase 1 only:
-- - Stores cash-out session state and audit events.
-- - Grants merchants read-only access to their own off-ramp records.
-- - Leaves all writes to service-role/server code.
-- - Does not create provider sessions, bank withdrawals, deposit addresses, or crypto broadcasts.

create table if not exists public.off_ramp_sessions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  provider text not null default 'moonpay',
  provider_session_id text null,
  external_transaction_id text null,
  asset text not null,
  network text not null,
  crypto_amount numeric null,
  quote_fiat_amount numeric null,
  quote_fiat_currency text not null default 'USD',
  quote_fee_amount numeric null,
  platform_fee_amount numeric null,
  quote_expires_at timestamptz null,
  source_wallet_address text null,
  refund_wallet_address text null,
  payout_method text null,
  status text not null default 'CREATED',
  provider_status text null,
  crypto_tx_hash text null,
  fiat_settled_at timestamptz null,
  fiat_settled_amount numeric null,
  error_code text null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint off_ramp_sessions_provider_check
    check (provider in ('moonpay', 'ramp', 'banxa', 'transak')),
  constraint off_ramp_sessions_status_check
    check (status in (
      'CREATED',
      'SETUP_REQUIRED',
      'QUOTE_READY',
      'AWAITING_APPROVAL',
      'AWAITING_CRYPTO',
      'SUBMITTED',
      'PROCESSING',
      'PAYOUT_INITIATED',
      'COMPLETED',
      'FAILED',
      'EXPIRED',
      'CANCELLED'
    )),
  constraint off_ramp_sessions_network_check
    check (network in ('base', 'solana', 'lightning')),
  constraint off_ramp_sessions_asset_check
    check (asset in ('ETH', 'USDC', 'SOL', 'BTC'))
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'off_ramp_sessions_id_merchant_id_key'
      and conrelid = 'public.off_ramp_sessions'::regclass
  ) then
    alter table public.off_ramp_sessions
      add constraint off_ramp_sessions_id_merchant_id_key unique (id, merchant_id);
  end if;
end $$;

create table if not exists public.off_ramp_events (
  id uuid primary key default gen_random_uuid(),
  off_ramp_session_id uuid not null,
  merchant_id uuid not null,
  event_type text not null,
  provider text not null default 'moonpay',
  provider_event_id text null,
  provider_status text null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint off_ramp_events_session_merchant_fk
    foreign key (off_ramp_session_id, merchant_id)
    references public.off_ramp_sessions(id, merchant_id)
    on delete cascade,
  constraint off_ramp_events_provider_check
    check (provider in ('moonpay', 'ramp', 'banxa', 'transak'))
);

create index if not exists off_ramp_sessions_merchant_created_at_idx
  on public.off_ramp_sessions (merchant_id, created_at desc);

create index if not exists off_ramp_sessions_merchant_status_idx
  on public.off_ramp_sessions (merchant_id, status);

create index if not exists off_ramp_sessions_provider_session_idx
  on public.off_ramp_sessions (provider, provider_session_id);

create index if not exists off_ramp_events_session_created_at_idx
  on public.off_ramp_events (off_ramp_session_id, created_at desc);

create index if not exists off_ramp_events_merchant_created_at_idx
  on public.off_ramp_events (merchant_id, created_at desc);

alter table public.off_ramp_sessions enable row level security;
alter table public.off_ramp_events enable row level security;

drop policy if exists "Merchants read own off-ramp sessions" on public.off_ramp_sessions;
create policy "Merchants read own off-ramp sessions"
  on public.off_ramp_sessions for select
  using (merchant_id::text = auth.uid()::text);

drop policy if exists "Merchants read own off-ramp events" on public.off_ramp_events;
create policy "Merchants read own off-ramp events"
  on public.off_ramp_events for select
  using (merchant_id::text = auth.uid()::text);

select pg_notify('pgrst', 'reload schema');
