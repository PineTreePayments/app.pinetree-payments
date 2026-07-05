ALTER TABLE pinetree_wallet_profiles
  ADD COLUMN IF NOT EXISTS dynamic_email TEXT;

CREATE INDEX IF NOT EXISTS pinetree_wallet_profiles_dynamic_email_idx
  ON pinetree_wallet_profiles (dynamic_email)
  WHERE dynamic_email IS NOT NULL;
