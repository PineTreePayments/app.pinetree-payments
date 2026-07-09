-- Keep merchant tax writes consistent with the project's timestamp pattern.
ALTER TABLE merchant_tax_settings
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE merchant_tax_settings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE merchant_tax_settings
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchant_tax_settings_updated_at ON merchant_tax_settings;

CREATE TRIGGER merchant_tax_settings_updated_at
  BEFORE UPDATE ON merchant_tax_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
