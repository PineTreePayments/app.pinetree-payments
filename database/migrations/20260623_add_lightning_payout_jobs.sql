-- PineTree Wallet Bitcoin Lightning settlement config and payout tracking.
-- Supports Speed platform treasury sweep:
-- customer pays Speed invoice -> PineTree fee retained -> merchant net swept to
-- the merchant's PineTree BTC address.

ALTER TABLE pinetree_wallet_profiles
  ADD COLUMN IF NOT EXISTS btc_address             TEXT,
  ADD COLUMN IF NOT EXISTS btc_address_type        TEXT,
  ADD COLUMN IF NOT EXISTS btc_wallet_provider     TEXT,
  ADD COLUMN IF NOT EXISTS btc_payout_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS btc_payout_verified_at  TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pinetree_wallet_profiles_btc_address_type_check'
  ) THEN
    ALTER TABLE pinetree_wallet_profiles
      ADD CONSTRAINT pinetree_wallet_profiles_btc_address_type_check
      CHECK (btc_address_type IS NULL OR btc_address_type IN ('taproot', 'native_segwit', 'unknown'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lightning_payout_jobs (
  id                         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                UUID          NOT NULL,
  payment_id                 UUID          NOT NULL,
  transaction_id             UUID,
  provider                   TEXT          NOT NULL,
  settlement_mode            TEXT          NOT NULL,
  speed_invoice_id           TEXT,
  speed_payment_id           TEXT,
  gross_amount_usd           NUMERIC(20,8) NOT NULL DEFAULT 0,
  platform_fee_usd           NUMERIC(20,8) NOT NULL DEFAULT 0,
  merchant_net_usd           NUMERIC(20,8) NOT NULL DEFAULT 0,
  merchant_net_sats          BIGINT        NOT NULL DEFAULT 0,
  btc_payout_address         TEXT          NOT NULL DEFAULT '',
  btc_address_type           TEXT,
  status                     TEXT          NOT NULL DEFAULT 'pending',
  speed_withdraw_request_id  TEXT,
  speed_payout_id            TEXT,
  txid                       TEXT,
  provider_response_summary  JSONB         NOT NULL DEFAULT '{}'::jsonb,
  attempt_count              INTEGER       NOT NULL DEFAULT 0,
  last_error                 TEXT,
  next_attempt_at            TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at               TIMESTAMPTZ,
  CONSTRAINT lightning_payout_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'canceled')),
  CONSTRAINT lightning_payout_jobs_amounts_check
    CHECK (gross_amount_usd >= 0 AND platform_fee_usd >= 0 AND merchant_net_usd >= 0 AND merchant_net_sats >= 0)
);

CREATE INDEX IF NOT EXISTS lightning_payout_jobs_pending_idx
  ON lightning_payout_jobs (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS lightning_payout_jobs_merchant_id_idx
  ON lightning_payout_jobs (merchant_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS lightning_payout_jobs_payment_active_unique
  ON lightning_payout_jobs (payment_id, provider, settlement_mode)
  WHERE status IN ('pending', 'processing', 'completed', 'failed');

CREATE UNIQUE INDEX IF NOT EXISTS lightning_payout_jobs_payment_completed_unique
  ON lightning_payout_jobs (payment_id, provider, settlement_mode)
  WHERE status = 'completed';
