-- merchant_lightning_profiles
-- Stores the PineTree-managed Lightning backend profile per merchant.
-- One row per merchant. PineTree provisions the Speed connected account;
-- merchants do not need to sign up for Speed or connect NWC.
-- status progression: not_configured → pending → ready | needs_attention
CREATE TABLE IF NOT EXISTS merchant_lightning_profiles (
  id                             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                    UUID         NOT NULL,
  provider                       TEXT         NOT NULL DEFAULT 'speed',
  status                         TEXT         NOT NULL DEFAULT 'not_configured',
  speed_connected_account_id     TEXT,
  speed_connected_account_relationship_id TEXT,
  speed_account_id               TEXT,
  speed_connected_account_status TEXT,
  speed_connect_setup_url        TEXT,
  provider_response_summary      JSONB,
  provider_error_message         TEXT,
  receive_mode                   TEXT         NOT NULL DEFAULT 'invoice',
  setup_source                   TEXT         NOT NULL DEFAULT 'pinetree_managed',
  last_checked_at                TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT merchant_lightning_profiles_merchant_unique UNIQUE (merchant_id)
);

CREATE INDEX IF NOT EXISTS merchant_lightning_profiles_merchant_id_idx
  ON merchant_lightning_profiles (merchant_id);

CREATE INDEX IF NOT EXISTS merchant_lightning_profiles_status_idx
  ON merchant_lightning_profiles (status);
