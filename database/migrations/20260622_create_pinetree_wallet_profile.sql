-- pinetree_wallet_profiles
-- Stores merchant-owned PineTree Wallet identity. One profile per merchant.
-- dynamic_user_id links the PineTree merchant account to the Dynamic embedded wallet session.
-- This is the source of truth for which wallet belongs to which merchant.
-- The merchant_wallets table remains for payment routing and is separate from this identity table.
CREATE TABLE IF NOT EXISTS pinetree_wallet_profiles (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id               UUID         NOT NULL,
  dynamic_user_id           TEXT,
  base_address              TEXT,
  solana_address            TEXT,
  bitcoin_lightning_address TEXT,
  bitcoin_onchain_address   TEXT,
  status                    TEXT         NOT NULL DEFAULT 'not_created',
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT pinetree_wallet_profiles_merchant_unique UNIQUE (merchant_id)
);

CREATE INDEX IF NOT EXISTS pinetree_wallet_profiles_merchant_id_idx
  ON pinetree_wallet_profiles (merchant_id);

CREATE INDEX IF NOT EXISTS pinetree_wallet_profiles_dynamic_user_id_idx
  ON pinetree_wallet_profiles (dynamic_user_id)
  WHERE dynamic_user_id IS NOT NULL;

-- wallet_withdrawal_requests
-- Scaffold for future PineTree Wallet merchant withdrawals.
-- All records remain in 'draft' status. No fund movement is implemented.
-- The status column is constrained to safe non-executing values until the
-- feature flag is enabled in a future release.
CREATE TABLE IF NOT EXISTS wallet_withdrawal_requests (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       UUID          NOT NULL,
  wallet_profile_id UUID          REFERENCES pinetree_wallet_profiles(id) ON DELETE SET NULL,
  rail              TEXT          NOT NULL,
  destination_address TEXT        NOT NULL DEFAULT '',
  amount            NUMERIC(20,8) NOT NULL DEFAULT 0,
  status            TEXT          NOT NULL DEFAULT 'draft',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallet_withdrawal_requests_merchant_id_idx
  ON wallet_withdrawal_requests (merchant_id);
