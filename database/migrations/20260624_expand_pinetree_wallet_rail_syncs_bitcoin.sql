-- Allows PineTree Wallet rail sync to track the canonical Bitcoin Lightning rail.

ALTER TABLE pinetree_wallet_rail_syncs
  DROP CONSTRAINT IF EXISTS pinetree_wallet_rail_syncs_rail_check;

ALTER TABLE pinetree_wallet_rail_syncs
  ADD CONSTRAINT pinetree_wallet_rail_syncs_rail_check
  CHECK (rail IN ('solana', 'base', 'bitcoin_lightning'));
