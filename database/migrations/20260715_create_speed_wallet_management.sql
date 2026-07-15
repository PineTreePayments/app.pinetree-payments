-- Speed Custom Connect wallet-management foundation.
--
-- Adds the normalized operation ledger, cached balance snapshots, automatic
-- payout/swap preferences, and webhook event idempotency table needed for
-- merchants to view and manage their Speed-hosted funds from PineTree.
--
-- IMPORTANT: as of this migration, Speed's official public API documentation
-- (apidocs.tryspeed.com) does not document ANY connected-account scoping
-- mechanism (header, query parameter, or body field) for the balance,
-- balance-transactions, withdraw-requests, send (Instant Send), or swap
-- endpoints - only /connect/custom, /connect, and /connect/{id} (account
-- creation/list/retrieve) are documented for Connect. See
-- providers/lightning/speedWalletManagement.ts for the resulting fail-closed
-- capability gate. This schema exists so the PineTree-side architecture is
-- complete and ready the moment Speed confirms that contract - it does not
-- imply any live fund-movement capability today.

-- ── Normalized wallet operation ledger ──────────────────────────────────────
-- One row per payment/transfer/withdrawal/payout/swap/fee/adjustment a
-- merchant's Speed Custom Connect account is party to, whether created by
-- PineTree (withdrawal/payout/swap requests) or observed via webhook
-- (incoming payments, application fee transfers).
CREATE TABLE IF NOT EXISTS merchant_wallet_operations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id           UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  provider              TEXT        NOT NULL DEFAULT 'speed',
  operation_type        TEXT        NOT NULL CHECK (operation_type IN (
                                       'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'WITHDRAWAL',
                                       'PAYOUT', 'SWAP_IN', 'SWAP_OUT', 'APPLICATION_FEE', 'ADJUSTMENT'
                                     )),
  direction             TEXT        NOT NULL CHECK (direction IN ('credit', 'debit')),
  status                TEXT        NOT NULL DEFAULT 'CREATED' CHECK (status IN (
                                       'CREATED', 'PENDING', 'PROCESSING', 'COMPLETED',
                                       'FAILED', 'CANCELED', 'EXPIRED', 'REQUIRES_ACTION'
                                     )),
  -- Base units only (e.g. SATS, not BTC; smallest USDC/USDT unit, not dollars).
  -- Never a float. See engine/wallet/speedWalletMoney.ts.
  asset                 TEXT        NOT NULL,
  network               TEXT        NOT NULL DEFAULT '',
  amount_base_units     BIGINT      NOT NULL CHECK (amount_base_units > 0),
  fee_base_units        BIGINT      CHECK (fee_base_units IS NULL OR fee_base_units >= 0),
  destination_summary   TEXT,
  tx_hash               TEXT,
  explorer_url          TEXT,
  provider_reference    TEXT,
  provider_status       TEXT,
  raw_provider_status   JSONB,
  failure_code          TEXT,
  failure_reason        TEXT,
  -- Required for every PineTree-initiated write (withdrawal/payout/swap).
  -- Webhook-observed rows (incoming payments) use a deterministic
  -- provider-event-derived key - see database/merchantWalletOperations.ts.
  idempotency_key       TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_wallet_operations_idempotency_key_uidx
  ON merchant_wallet_operations (merchant_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_wallet_operations_provider_reference_uidx
  ON merchant_wallet_operations (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS merchant_wallet_operations_merchant_created_idx
  ON merchant_wallet_operations (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS merchant_wallet_operations_merchant_status_idx
  ON merchant_wallet_operations (merchant_id, status);

CREATE INDEX IF NOT EXISTS merchant_wallet_operations_merchant_type_idx
  ON merchant_wallet_operations (merchant_id, operation_type);

ALTER TABLE merchant_wallet_operations ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth only - matches the shopify_connections pattern. Real
-- enforcement is application-layer: every route resolves merchant_id from
-- the authenticated request (lib/api/merchantAuth.ts) and every query is
-- explicitly filtered by it (database/merchantWalletOperations.ts). All
-- reads/writes go through the service-role client, which bypasses RLS.
CREATE POLICY merchant_wallet_operations_merchant_select
  ON merchant_wallet_operations
  FOR SELECT
  USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER merchant_wallet_operations_updated_at
  BEFORE UPDATE ON merchant_wallet_operations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE merchant_wallet_operations IS
  'Normalized ledger of Speed Custom Connect wallet operations (payments, transfers, withdrawals, payouts, swaps, fees) per merchant. Amounts are integer base units, never floats.';

-- ── Cached balance snapshots ────────────────────────────────────────────────
-- Populated only once a confirmed Speed balance read is possible for a
-- connected account (see providers/lightning/speedWalletManagement.ts). Until
-- then this table stays empty and the dashboard shows an unavailable state,
-- never a fabricated balance.
CREATE TABLE IF NOT EXISTS merchant_wallet_balance_snapshots (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id           UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  provider              TEXT        NOT NULL DEFAULT 'speed',
  asset                 TEXT        NOT NULL,
  network               TEXT        NOT NULL DEFAULT '',
  available_base_units  BIGINT      NOT NULL DEFAULT 0 CHECK (available_base_units >= 0),
  pending_base_units    BIGINT      NOT NULL DEFAULT 0 CHECK (pending_base_units >= 0),
  total_base_units      BIGINT      NOT NULL DEFAULT 0 CHECK (total_base_units >= 0),
  provider_updated_at   TIMESTAMPTZ,
  cached_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_wallet_balance_snapshots_uidx
  ON merchant_wallet_balance_snapshots (merchant_id, provider, asset, network);

ALTER TABLE merchant_wallet_balance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY merchant_wallet_balance_snapshots_merchant_select
  ON merchant_wallet_balance_snapshots
  FOR SELECT
  USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE TRIGGER merchant_wallet_balance_snapshots_updated_at
  BEFORE UPDATE ON merchant_wallet_balance_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE merchant_wallet_balance_snapshots IS
  'Most recently fetched Speed Custom Connect balance per merchant/asset. Empty until a confirmed connected-account balance read is implemented.';

-- ── Automatic payout / automatic swap preferences ───────────────────────────
-- Stores merchant INTENT only. auto_swap_status / the payout scheduler both
-- stay non-executing until a confirmed Speed capability exists - see
-- engine/wallet/speedWalletPreferences.ts.
CREATE TABLE IF NOT EXISTS merchant_wallet_preferences (
  id                                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                            UUID        NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
  auto_payout_enabled                    BOOLEAN     NOT NULL DEFAULT false,
  auto_payout_schedule                   TEXT        NOT NULL DEFAULT 'disabled'
                                                       CHECK (auto_payout_schedule IN ('disabled', 'daily', 'weekly', 'threshold')),
  auto_payout_destination                TEXT,
  auto_payout_source_asset               TEXT,
  auto_payout_min_threshold_base_units   BIGINT      CHECK (auto_payout_min_threshold_base_units IS NULL OR auto_payout_min_threshold_base_units >= 0),
  auto_payout_retained_balance_base_units BIGINT     CHECK (auto_payout_retained_balance_base_units IS NULL OR auto_payout_retained_balance_base_units >= 0),
  auto_payout_last_attempted_at          TIMESTAMPTZ,
  auto_payout_next_eligible_at           TIMESTAMPTZ,
  auto_payout_failure_state              TEXT,
  auto_swap_enabled                      BOOLEAN     NOT NULL DEFAULT false,
  auto_swap_source_asset                 TEXT,
  auto_swap_target_asset                 TEXT,
  auto_swap_mode                         TEXT,
  auto_swap_status                       TEXT        NOT NULL DEFAULT 'pending_provider_support'
                                                       CHECK (auto_swap_status IN ('active', 'pending_provider_support', 'unavailable')),
  created_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE merchant_wallet_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY merchant_wallet_preferences_merchant_select
  ON merchant_wallet_preferences
  FOR SELECT
  USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE TRIGGER merchant_wallet_preferences_updated_at
  BEFORE UPDATE ON merchant_wallet_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE merchant_wallet_preferences IS
  'Merchant automatic-payout and automatic-swap intent for Speed Custom Connect wallet management. Execution stays disabled until a confirmed Speed capability exists.';

-- ── Webhook event idempotency ───────────────────────────────────────────────
-- Every Speed webhook delivery carries a unique webhook-id header. This
-- table guarantees a redelivered/duplicate event can never be normalized
-- into merchant_wallet_operations twice, independent of the pre-existing
-- payment webhook idempotency in the payments/ledger tables.
CREATE TABLE IF NOT EXISTS speed_webhook_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id TEXT        NOT NULL,
  event_type        TEXT        NOT NULL,
  account_id        TEXT,
  merchant_id       UUID        REFERENCES merchants(id) ON DELETE SET NULL,
  wallet_operation_id UUID      REFERENCES merchant_wallet_operations(id) ON DELETE SET NULL,
  processed_at      TIMESTAMPTZ,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload       JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS speed_webhook_events_provider_event_id_uidx
  ON speed_webhook_events (provider_event_id);

CREATE INDEX IF NOT EXISTS speed_webhook_events_merchant_id_idx
  ON speed_webhook_events (merchant_id);

ALTER TABLE speed_webhook_events ENABLE ROW LEVEL SECURITY;

-- No merchant/anon/authenticated access - service-role only, same lockdown
-- pattern as merchant_speed_credentials / merchant_lightning_sweeps. Raw
-- webhook payloads are an internal diagnostic record, never merchant-facing.
REVOKE ALL ON speed_webhook_events FROM anon, authenticated;

COMMENT ON TABLE speed_webhook_events IS
  'Idempotency + diagnostic record of every Speed webhook delivery normalized (or considered) for wallet-operation purposes. Service-role access only.';
