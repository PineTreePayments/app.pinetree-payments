-- Migration: create shopify_connections
-- Stores one row per connected Shopify store. The access_token column holds
-- the Shopify permanent access token ENCRYPTED at the application layer before
-- INSERT/UPDATE — the database never sees the plaintext token.

CREATE TABLE IF NOT EXISTS shopify_connections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop            TEXT        NOT NULL,
  merchant_id     UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  -- Encrypted at application layer. Never store plaintext here.
  access_token    TEXT        NOT NULL,
  scopes          TEXT        NOT NULL DEFAULT '',
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'uninstalled')),
  installed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  uninstalled_at  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active connection per shop. A merchant can re-install after
-- uninstalling, which creates a new row (the old row's status becomes
-- 'uninstalled' via the app/uninstalled webhook).
CREATE UNIQUE INDEX IF NOT EXISTS shopify_connections_shop_active_uidx
  ON shopify_connections (shop)
  WHERE status = 'active';

-- Allow fast lookup of all shops belonging to a PineTree merchant.
CREATE INDEX IF NOT EXISTS shopify_connections_merchant_id_idx
  ON shopify_connections (merchant_id);

-- Row-level security: merchants may only read their own connection rows.
ALTER TABLE shopify_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY shopify_connections_merchant_select
  ON shopify_connections
  FOR SELECT
  USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

-- Trigger to keep updated_at current.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER shopify_connections_updated_at
  BEFORE UPDATE ON shopify_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  shopify_connections               IS 'Shopify stores connected to PineTree merchant accounts via OAuth.';
COMMENT ON COLUMN shopify_connections.access_token  IS 'Shopify permanent access token — encrypted at application layer before storage.';
COMMENT ON COLUMN shopify_connections.status        IS 'active = installed and authorized; uninstalled = app/uninstalled webhook received.';
