-- Expand the btc_address_type CHECK constraint to include legacy and nested_segwit address types.
-- Legacy (P2PKH) addresses start with '1'; nested SegWit (P2SH-P2WPKH) addresses start with '3'.
-- Dynamic embedded wallets (Fireblocks/Turnkey) provision Taproot or Native SegWit addresses.
-- Legacy and nested_segwit are recognized so they can be stored correctly if encountered.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pinetree_wallet_profiles_btc_address_type_check'
  ) THEN
    ALTER TABLE pinetree_wallet_profiles
      DROP CONSTRAINT pinetree_wallet_profiles_btc_address_type_check;
  END IF;

  ALTER TABLE pinetree_wallet_profiles
    ADD CONSTRAINT pinetree_wallet_profiles_btc_address_type_check
    CHECK (
      btc_address_type IS NULL
      OR btc_address_type IN ('taproot', 'native_segwit', 'legacy', 'nested_segwit', 'unknown')
    );
END $$;
