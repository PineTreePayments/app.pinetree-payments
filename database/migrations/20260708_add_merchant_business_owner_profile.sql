-- Reusable merchant Business Profile fields used to gate live payment products
-- and initialize provider onboarding server-side. Do not store SSN, DOB, EIN,
-- or provider secrets here; sensitive provider requirements should use hosted
-- provider onboarding/tokenization.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS owner_first_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_last_name TEXT,
  ADD COLUMN IF NOT EXISTS business_country TEXT;

ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS legal_business_name TEXT,
  ADD COLUMN IF NOT EXISTS business_dba TEXT,
  ADD COLUMN IF NOT EXISTS business_country TEXT,
  ADD COLUMN IF NOT EXISTS business_state TEXT,
  ADD COLUMN IF NOT EXISTS business_city TEXT,
  ADD COLUMN IF NOT EXISTS business_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS business_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS business_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS business_phone TEXT,
  ADD COLUMN IF NOT EXISTS business_website TEXT,
  ADD COLUMN IF NOT EXISTS owner_first_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_last_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS owner_phone TEXT,
  ADD COLUMN IF NOT EXISTS profile_status TEXT NOT NULL DEFAULT 'incomplete',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE merchant_settings
  DROP CONSTRAINT IF EXISTS merchant_settings_profile_status_check;

ALTER TABLE merchant_settings
  ADD CONSTRAINT merchant_settings_profile_status_check
  CHECK (profile_status IN ('incomplete', 'complete', 'needs_attention'));
