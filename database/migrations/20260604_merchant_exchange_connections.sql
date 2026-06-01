-- merchant_exchange_connections
-- Stores Mesh exchange connection metadata per merchant.
-- No exchange passwords, API keys, or raw auth tokens are stored here.
-- The access token obtained from the Mesh SDK is short-lived and passed
-- directly from the client to the server during import; it is never persisted.

CREATE TABLE IF NOT EXISTS merchant_exchange_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mesh',
  institution_name text,
  institution_id text,
  mesh_integration_id text,
  mesh_account_id text,
  mesh_auth_token_id text,   -- opaque reference only; no raw token stored
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz
);

ALTER TABLE merchant_exchange_connections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchant_exchange_connections'
      AND policyname = 'merchant_exchange_connections_own'
  ) THEN
    CREATE POLICY merchant_exchange_connections_own
      ON merchant_exchange_connections
      FOR ALL
      USING (merchant_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS merchant_exchange_connections_merchant_idx
  ON merchant_exchange_connections (merchant_id);
