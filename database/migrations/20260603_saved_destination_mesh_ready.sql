ALTER TABLE merchant_settlement_destinations
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS connected_provider text,
  ADD COLUMN IF NOT EXISTS external_account_name text,
  ADD COLUMN IF NOT EXISTS external_account_id text,
  ADD COLUMN IF NOT EXISTS institution_name text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

UPDATE merchant_settlement_destinations
SET
  account_type = CASE
    WHEN account_type IN ('business_exchange', 'personal_exchange', 'external_wallet', 'other') THEN account_type
    ELSE 'other'
  END,
  source = CASE
    WHEN source IN ('manual', 'mesh', 'provider_import', 'unknown') THEN source
    ELSE 'manual'
  END,
  connected_provider = CASE
    WHEN connected_provider IN ('mesh', 'manual') THEN connected_provider
    ELSE 'manual'
  END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'merchant_settlement_destinations_account_type_check'
  ) THEN
    ALTER TABLE merchant_settlement_destinations
      ADD CONSTRAINT merchant_settlement_destinations_account_type_check
      CHECK (account_type IN ('business_exchange', 'personal_exchange', 'external_wallet', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'merchant_settlement_destinations_source_check'
  ) THEN
    ALTER TABLE merchant_settlement_destinations
      ADD CONSTRAINT merchant_settlement_destinations_source_check
      CHECK (source IN ('manual', 'mesh', 'provider_import', 'unknown'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'merchant_settlement_destinations_connected_provider_check'
  ) THEN
    ALTER TABLE merchant_settlement_destinations
      ADD CONSTRAINT merchant_settlement_destinations_connected_provider_check
      CHECK (connected_provider IS NULL OR connected_provider IN ('mesh', 'manual'));
  END IF;
END $$;
