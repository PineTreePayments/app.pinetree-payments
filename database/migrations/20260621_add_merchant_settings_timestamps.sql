-- Migration: add merchant_settings timestamps
-- Keeps settings writes aligned with application code that upserts updated_at.

ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE merchant_settings
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

-- Reuse the project's updated_at trigger pattern.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchant_settings_updated_at ON merchant_settings;

CREATE TRIGGER merchant_settings_updated_at
  BEFORE UPDATE ON merchant_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
