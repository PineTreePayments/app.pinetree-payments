-- Add PineTree-managed Lightning backend fields to pinetree_wallet_profiles.
-- These denormalize the merchant_lightning_profiles status into the wallet profile
-- so the overall wallet readiness can be computed from a single row.
-- lightning_status: not_configured | pending | ready | needs_attention
-- lightning_provider: speed (only supported value for now)
-- lightning_receive_mode: invoice
-- lightning_account_id: Speed connected account ID if provisioned
ALTER TABLE pinetree_wallet_profiles
  ADD COLUMN IF NOT EXISTS bitcoin_lightning_status        TEXT NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS bitcoin_lightning_provider      TEXT,
  ADD COLUMN IF NOT EXISTS bitcoin_lightning_receive_mode  TEXT NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS bitcoin_lightning_account_id    TEXT;
