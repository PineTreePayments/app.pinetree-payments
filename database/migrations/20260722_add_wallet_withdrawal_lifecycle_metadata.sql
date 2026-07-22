-- Add explicit lifecycle metadata for PineTree Wallet withdrawal requests.
-- These columns are additive and safe to run repeatedly.

alter table public.wallet_withdrawal_requests
  add column if not exists provider_request_id text,
  add column if not exists submitted_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists failed_at timestamptz;

create index if not exists wallet_withdrawal_requests_processing_reconcile_idx
  on public.wallet_withdrawal_requests (status, rail, created_at)
  where status = 'processing'
    and rail in ('base', 'solana')
    and (tx_hash is not null or provider_reference is not null);

comment on column public.wallet_withdrawal_requests.provider_request_id is
  'Provider request id or request-scoped reference for a submitted withdrawal, when supplied by the provider.';

comment on column public.wallet_withdrawal_requests.submitted_at is
  'Timestamp when PineTree accepted provider broadcast evidence and moved the withdrawal into processing.';

comment on column public.wallet_withdrawal_requests.confirmed_at is
  'Timestamp when PineTree reconciled the withdrawal as confirmed from chain/provider evidence.';

comment on column public.wallet_withdrawal_requests.failed_at is
  'Timestamp when PineTree reconciled or definitively marked the withdrawal failed.';
