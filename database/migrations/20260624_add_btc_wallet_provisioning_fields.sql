-- Internal Bitcoin wallet provisioning diagnostics for PineTree Wallet.
-- These fields are server-side operational metadata; merchants should only see
-- the resulting btc_address when provisioning succeeds.

ALTER TABLE pinetree_wallet_profiles
  ADD COLUMN IF NOT EXISTS btc_wallet_provider_ref          TEXT,
  ADD COLUMN IF NOT EXISTS btc_wallet_last_provisioned_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS btc_wallet_provisioning_status   TEXT,
  ADD COLUMN IF NOT EXISTS btc_wallet_provisioning_error    TEXT;

