-- Adds shared columns to the two existing, independent withdrawal ledgers
-- (wallet_withdrawal_requests for Base/Solana, merchant_wallet_operations
-- for Bitcoin/Speed) so callers going through the new canonical dispatcher
-- (engine/withdrawals/canonicalWithdrawal.ts) can distinguish how a
-- withdrawal was triggered and preserve a point-in-time destination snapshot,
-- independent of later edits to the saved address-book row.
--
-- This does NOT merge the two tables - each rail keeps its own, already
-- live and tested execution path. It only adds reporting/audit parity.

alter table public.wallet_withdrawal_requests
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'saved_address', 'automatic_sweep')),
  add column if not exists destination_id uuid references public.merchant_withdrawal_destinations(id),
  add column if not exists destination_snapshot jsonb,
  add column if not exists idempotency_key text,
  add column if not exists fee_amount_decimal text,
  add column if not exists native_fee_asset text,
  add column if not exists error_code text;

-- Nullable and only enforced unique when present - most existing rows (and
-- most manual withdrawals going forward) may not carry one, but automatic
-- sweeps always must.
create unique index if not exists wallet_withdrawal_requests_idempotency_idx
  on public.wallet_withdrawal_requests (merchant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists wallet_withdrawal_requests_destination_idx
  on public.wallet_withdrawal_requests (destination_id)
  where destination_id is not null;

comment on column public.wallet_withdrawal_requests.destination_snapshot is
  'Point-in-time copy of the destination (address/label/rail/asset/method) at submission time, so a later edit to the saved address-book row can never silently alter an existing withdrawal record.';

-- merchant_wallet_operations already has idempotency_key (unique per
-- merchant) and fee_base_units - only add what's missing.
alter table public.merchant_wallet_operations
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'saved_address', 'automatic_sweep')),
  add column if not exists destination_id uuid references public.merchant_withdrawal_destinations(id),
  add column if not exists destination_snapshot jsonb;

create index if not exists merchant_wallet_operations_destination_idx
  on public.merchant_wallet_operations (destination_id)
  where destination_id is not null;

comment on column public.merchant_wallet_operations.destination_snapshot is
  'Point-in-time copy of the destination at submission time, same purpose as wallet_withdrawal_requests.destination_snapshot.';
