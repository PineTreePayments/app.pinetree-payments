-- Ensure PineTree Wallet balance snapshots can upsert one row per merchant asset key.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_balances_merchant_asset_unique
  ON wallet_balances (merchant_id, asset);
