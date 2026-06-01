-- merchant_wallet_send_sessions
-- Tracks approval sessions created by the desktop for outbound merchant sends.
-- The merchant scans a QR on their phone; the phone opens the PineTree approval
-- page which signs the prepared transaction in their specific wallet app.
-- PineTree never stores private keys or signing material.

CREATE TABLE IF NOT EXISTS merchant_wallet_send_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         uuid        NOT NULL,
  wallet_id           uuid        NOT NULL,
  rail                text        NOT NULL,
  wallet_type         text        NOT NULL,
  wallet_address      text        NOT NULL,
  asset               text        NOT NULL,
  network             text        NOT NULL,
  destination_address text        NOT NULL,
  destination_label   text        NULL,
  amount              text        NOT NULL,
  prepared_payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL DEFAULT 'created',
  tx_hash             text        NULL,
  signature           text        NULL,
  error               text        NULL,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Allowed status values (enforced in application layer):
--   created, opened, wallet_connecting, wallet_connected,
--   approval_requested, approved, submitted, rejected, expired, failed

CREATE INDEX IF NOT EXISTS mwss_merchant_id_idx  ON merchant_wallet_send_sessions (merchant_id);
CREATE INDEX IF NOT EXISTS mwss_wallet_id_idx    ON merchant_wallet_send_sessions (wallet_id);
CREATE INDEX IF NOT EXISTS mwss_status_idx       ON merchant_wallet_send_sessions (status);
CREATE INDEX IF NOT EXISTS mwss_expires_at_idx   ON merchant_wallet_send_sessions (expires_at);
