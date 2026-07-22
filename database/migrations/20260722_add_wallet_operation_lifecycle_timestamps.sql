-- Adds the same explicit lifecycle timestamps that
-- 20260722_add_wallet_withdrawal_lifecycle_metadata.sql added to
-- wallet_withdrawal_requests (Base/Solana), but for merchant_wallet_operations
-- (Bitcoin/Speed) - the table previously only had completed_at, which meant
-- the two withdrawal ledgers exposed asymmetric lifecycle data even though
-- both feed the same canonical PineTree Wallet Activity surface.
--
-- Additive and safe to run repeatedly.

alter table public.merchant_wallet_operations
  add column if not exists submitted_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists failed_at timestamptz;

comment on column public.merchant_wallet_operations.submitted_at is
  'Timestamp when PineTree moved this operation to PROCESSING after a successful provider send request.';

comment on column public.merchant_wallet_operations.confirmed_at is
  'Timestamp when PineTree reconciled this operation as COMPLETED from provider evidence.';

comment on column public.merchant_wallet_operations.failed_at is
  'Timestamp when PineTree reconciled or definitively marked this operation FAILED.';
