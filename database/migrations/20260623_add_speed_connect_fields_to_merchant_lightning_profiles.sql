-- Add safe Speed Connect setup metadata to PineTree-managed Lightning profiles.
-- No Speed API keys, webhook secrets, NWC secrets, or fund-movement credentials
-- are stored here.
ALTER TABLE merchant_lightning_profiles
  ADD COLUMN IF NOT EXISTS speed_connect_setup_url   TEXT,
  ADD COLUMN IF NOT EXISTS provider_response_summary JSONB,
  ADD COLUMN IF NOT EXISTS provider_error_message    TEXT;
