-- Preserve the full merchant-entered destination for Bitcoin/Speed wallet
-- withdrawals. `destination_summary` remains the masked list display value;
-- these fields are for audit/detail views and are populated for new rows.

alter table public.merchant_wallet_operations
  add column if not exists destination_address text,
  add column if not exists destination_label text;

comment on column public.merchant_wallet_operations.destination_address is
  'Full merchant-entered withdrawal destination captured at submission time. New Bitcoin/Speed withdrawals use this for audit/detail display; older rows may be null.';

comment on column public.merchant_wallet_operations.destination_label is
  'Optional merchant-provided or saved-destination label captured at submission time.';
