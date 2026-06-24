-- Creates the pinetree_wallet_rail_syncs table.
-- Records when a PineTree Wallet address was last synced into the merchant_wallets
-- and merchant_providers tables for a given rail. Enables idempotent re-sync.

CREATE TABLE IF NOT EXISTS pinetree_wallet_rail_syncs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  rail            TEXT NOT NULL CHECK (rail IN ('solana', 'base')),
  synced_address  TEXT NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, rail)
);

CREATE INDEX IF NOT EXISTS pinetree_wallet_rail_syncs_merchant_id_idx
  ON pinetree_wallet_rail_syncs (merchant_id);
