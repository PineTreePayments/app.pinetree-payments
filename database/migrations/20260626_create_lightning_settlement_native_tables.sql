-- PineTree-native Lightning settlement tables.
-- Speed Connect remains the preferred long-term architecture for true
-- sub-account settlement. This layer is env-gated and keeps merchant setup,
-- payout destination selection, and payout status inside PineTree.

create table if not exists merchant_payout_destinations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  rail text not null,
  asset text not null,
  destination_type text not null,
  destination_address text not null,
  label text null,
  status text not null default 'active',
  verified_at timestamptz null,
  provider text null,
  provider_reference text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_payout_destinations_type_check
    check (destination_type in ('pinetree_btc_wallet', 'external_btc_wallet', 'speed_connected_account')),
  constraint merchant_payout_destinations_status_check
    check (status in ('active', 'disabled', 'pending_verification'))
);

create index if not exists merchant_payout_destinations_merchant_idx
  on merchant_payout_destinations (merchant_id, rail, asset, status);

create table if not exists lightning_settlement_settings (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null unique,
  provider text not null default 'speed',
  enabled boolean not null default false,
  autoswap_enabled boolean not null default false,
  payout_destination_id uuid null references merchant_payout_destinations(id),
  provider_account_id text null,
  provider_reference text null,
  provider_sync_status text not null default 'not_synced',
  last_synced_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lightning_settlement_settings_sync_status_check
    check (provider_sync_status in ('not_synced', 'synced', 'pending', 'failed', 'not_available'))
);

create table if not exists lightning_settlement_payout_jobs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  payment_id uuid not null,
  transaction_id uuid null,
  speed_payment_id text null,
  gross_amount_decimal text not null,
  fee_amount_decimal text not null,
  merchant_net_amount_decimal text not null,
  asset text not null default 'BTC',
  destination_address text not null,
  destination_type text not null,
  status text not null default 'queued',
  provider text not null default 'speed',
  provider_payout_id text null,
  provider_reference text null,
  tx_hash text null,
  attempt_count integer not null default 0,
  last_error text null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lightning_settlement_payout_jobs_status_check
    check (status in ('queued', 'processing', 'submitted', 'completed', 'failed', 'canceled')),
  constraint lightning_settlement_payout_jobs_destination_type_check
    check (destination_type in ('pinetree_btc_wallet', 'external_btc_wallet', 'speed_connected_account'))
);

create index if not exists lightning_settlement_payout_jobs_queue_idx
  on lightning_settlement_payout_jobs (status, created_at);

create index if not exists lightning_settlement_payout_jobs_merchant_idx
  on lightning_settlement_payout_jobs (merchant_id, created_at desc);
