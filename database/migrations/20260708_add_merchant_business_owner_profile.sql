-- Business-owner identity fields required by Speed Custom Connect account
-- creation (country, first_name, last_name). Collected once from the merchant
-- so PineTree Wallet setup can automatically provision the Speed connected
-- account without redirecting the merchant to Speed's own signup flow.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS owner_first_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_last_name TEXT,
  ADD COLUMN IF NOT EXISTS business_country TEXT;
