-- Migration: merchant_settlement_preferences
-- Stores the merchant's settlement mode preference.
-- One row per merchant (unique constraint on merchant_id).
-- Only "manual" is currently active; end_of_day and auto are coming soon.

CREATE TABLE IF NOT EXISTS merchant_settlement_preferences (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID        NOT NULL UNIQUE,
  mode        TEXT        NOT NULL DEFAULT 'manual',
  end_of_day_time TEXT,
  timezone    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_settlement_pref_mode CHECK (
    mode IN ('manual', 'end_of_day', 'auto')
  )
);

CREATE INDEX IF NOT EXISTS idx_settlement_preferences_merchant_id
  ON merchant_settlement_preferences (merchant_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE merchant_settlement_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settlement_preferences_select" ON merchant_settlement_preferences;
DROP POLICY IF EXISTS "settlement_preferences_insert" ON merchant_settlement_preferences;
DROP POLICY IF EXISTS "settlement_preferences_update" ON merchant_settlement_preferences;

CREATE POLICY "settlement_preferences_select"
  ON merchant_settlement_preferences FOR SELECT
  TO authenticated
  USING (merchant_id = auth.uid());

CREATE POLICY "settlement_preferences_insert"
  ON merchant_settlement_preferences FOR INSERT
  TO authenticated
  WITH CHECK (merchant_id = auth.uid());

CREATE POLICY "settlement_preferences_update"
  ON merchant_settlement_preferences FOR UPDATE
  TO authenticated
  USING  (merchant_id = auth.uid())
  WITH CHECK (merchant_id = auth.uid());
