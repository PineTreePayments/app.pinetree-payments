-- PineTree automatic Lightning sweep foundation.
--
-- After a merchant receives a confirmed Lightning payment settled into their
-- Speed Custom Connect account balance, PineTree automatically transfers the
-- eligible net SATS to a fresh BOLT11 invoice from the same merchant's
-- PineTree Wallet ("Speed Instant Send"). The exact Instant Send endpoint,
-- request/response schema, and balance endpoint have not been supplied by
-- Speed yet - this table and its state machine exist so the queueing,
-- idempotency, retry, and admin-visibility foundation is in place and
-- fail-closed (status stays 'awaiting_configuration') until Speed's contract
-- is confirmed and wired into providers/lightning/speedInstantSend.ts.
create table if not exists public.merchant_lightning_sweeps (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  source_payment_id uuid not null,
  speed_connected_account_id text not null,
  speed_header_account_id text null,
  destination_wallet_profile_id text null,
  destination_invoice text null,
  destination_invoice_hash text null,
  destination_invoice_expires_at timestamptz null,
  requested_amount_sats bigint not null,
  fee_reserve_sats bigint not null default 0,
  sent_amount_sats bigint null,
  provider_send_id text null,
  provider_status text null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  idempotency_key text not null,
  next_attempt_at timestamptz null,
  last_attempt_at timestamptz null,
  last_error_code text null,
  last_error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint merchant_lightning_sweeps_status_check
    check (status in (
      'queued',
      'awaiting_configuration',
      'awaiting_balance',
      'awaiting_invoice',
      'invoice_created',
      'sending',
      'processing',
      'confirmed',
      'retryable_failed',
      'failed',
      'canceled'
    )),
  constraint merchant_lightning_sweeps_requested_amount_check
    check (requested_amount_sats > 0),
  constraint merchant_lightning_sweeps_fee_reserve_check
    check (fee_reserve_sats >= 0)
);

-- One sweep per (merchant_id, source_payment_id, sweep_version) - see
-- database/merchantLightningSweeps.ts for the exact idempotency key format.
-- A repeated payment.paid webhook (retry or duplicate delivery) must resolve
-- to this same row, never a second one.
create unique index if not exists merchant_lightning_sweeps_idempotency_key_uidx
  on public.merchant_lightning_sweeps (idempotency_key);

-- A given provider send id must never be attached to more than one sweep row.
create unique index if not exists merchant_lightning_sweeps_provider_send_id_uidx
  on public.merchant_lightning_sweeps (provider_send_id)
  where provider_send_id is not null;

create index if not exists merchant_lightning_sweeps_status_next_attempt_idx
  on public.merchant_lightning_sweeps (status, next_attempt_at);

create index if not exists merchant_lightning_sweeps_merchant_id_idx
  on public.merchant_lightning_sweeps (merchant_id);

create index if not exists merchant_lightning_sweeps_source_payment_id_idx
  on public.merchant_lightning_sweeps (source_payment_id);

alter table public.merchant_lightning_sweeps enable row level security;

-- No merchant, authenticated client, or anonymous access. Only the
-- service-role client (supabaseAdmin) may create or update sweep records,
-- from server-side engine code (engine/lightningSweep.ts) and admin-only
-- routes (app/api/admin/lightning-sweeps/*). Never expose this table
-- through a merchant-facing API - merchants only ever see PineTree-branded
-- Lightning transfer status, never Speed account identifiers.
revoke all on public.merchant_lightning_sweeps from anon, authenticated;

comment on table public.merchant_lightning_sweeps is
  'Queued/processing/completed outbound transfers of settled Speed Custom Connect Lightning balance to a merchant''s PineTree Wallet BOLT11 invoice. Service-role access only.';
