-- ============================================================
-- PineTree Payments — Enable RLS on all public schema tables
-- Date: 2026-06-02
-- Resolves: rls_disabled_in_public, sensitive_columns_exposed
--
-- Architecture note:
--   ALL database writes and reads go through Next.js API routes
--   using the Supabase service_role key (supabaseAdmin). That
--   client bypasses RLS entirely, so enabling RLS here does NOT
--   break any existing app functionality.
--
--   The four database helpers that previously imported the raw
--   anon client (devices, locations, terminals, routingRules)
--   have been fixed in the same commit to use supabaseAdmin.
--
-- Policy strategy:
--   • Non-sensitive merchant-owned tables  → SELECT to authenticated
--     where merchant_id = auth.uid()       (defence-in-depth)
--   • Sensitive/credential tables          → NO policies
--     (service_role-only access)
--   • Internal/event/session tables        → NO policies
--     (service_role-only access)
--   • anon role                            → denied on every table
--     (no policies granted to anon)
--
-- Public-safe exceptions:
--   - /pay checkout page reads via API route → no table grant needed
--   - /wallet-approval page reads via API route → no table grant needed
--   - Webhooks write via API route using service_role → fine
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- STEP 0 — Drop any existing unsafe broad policies
--           (e.g. using (true) / with_check (true) from
--            Supabase dashboard quick-setup templates)
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END
$$;


-- ────────────────────────────────────────────────────────────
-- STEP 1 — Enable RLS on all public tables
-- ────────────────────────────────────────────────────────────

-- Core financial / transactional tables
ALTER TABLE IF EXISTS public.payments                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_events                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_intents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ledger_entries                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.idempotency_keys                ENABLE ROW LEVEL SECURITY;

-- Merchant identity / configuration
ALTER TABLE IF EXISTS public.merchants                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.merchant_settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.merchant_tax_settings           ENABLE ROW LEVEL SECURITY;

-- Payment providers — SENSITIVE: credentials JSONB holds NWC URIs, Speed config
ALTER TABLE IF EXISTS public.merchant_providers              ENABLE ROW LEVEL SECURITY;

-- Wallets and balances
ALTER TABLE IF EXISTS public.merchant_wallets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallet_balances                 ENABLE ROW LEVEL SECURITY;

-- API keys — SENSITIVE: key_hash stored
ALTER TABLE IF EXISTS public.merchant_api_keys               ENABLE ROW LEVEL SECURITY;

-- Webhooks — SENSITIVE: secret field stored
ALTER TABLE IF EXISTS public.merchant_webhooks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.webhook_deliveries              ENABLE ROW LEVEL SECURITY;

-- Checkout / links
ALTER TABLE IF EXISTS public.checkout_links                  ENABLE ROW LEVEL SECURITY;

-- Settlement
ALTER TABLE IF EXISTS public.merchant_settlement_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settlement_withdrawals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settlement_preferences          ENABLE ROW LEVEL SECURITY;

-- Off-ramp
ALTER TABLE IF EXISTS public.off_ramp_sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.off_ramp_events                 ENABLE ROW LEVEL SECURITY;

-- Wallet operations
ALTER TABLE IF EXISTS public.wallet_operations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallet_operation_events         ENABLE ROW LEVEL SECURITY;

-- Send sessions (wallet approval flow)
ALTER TABLE IF EXISTS public.merchant_wallet_send_sessions   ENABLE ROW LEVEL SECURITY;

-- Exchange / Mesh connections — SENSITIVE: mesh_auth_token_id stored
ALTER TABLE IF EXISTS public.merchant_exchange_connections   ENABLE ROW LEVEL SECURITY;

-- Merchant credentials — VERY SENSITIVE: raw credential values
ALTER TABLE IF EXISTS public.merchant_credentials            ENABLE ROW LEVEL SECURITY;

-- Solflare deeplink sessions — VERY SENSITIVE: dapp_secret_key (byte array)
ALTER TABLE IF EXISTS public.solflare_deeplink_sessions      ENABLE ROW LEVEL SECURITY;

-- WalletConnect sessions
ALTER TABLE IF EXISTS public.wallet_connection_sessions      ENABLE ROW LEVEL SECURITY;

-- Support
ALTER TABLE IF EXISTS public.support_tickets                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.support_ticket_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.merchant_feedback               ENABLE ROW LEVEL SECURITY;

-- POS
ALTER TABLE IF EXISTS public.locations                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.devices                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.terminals                       ENABLE ROW LEVEL SECURITY;  -- SENSITIVE: pin field
ALTER TABLE IF EXISTS public.cash_drawer_log                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.routing_rules                   ENABLE ROW LEVEL SECURITY;

-- Miscellaneous
ALTER TABLE IF EXISTS public.system_status                   ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- STEP 2 — Revoke anon SELECT on all public tables
--           (belt-and-suspenders on top of RLS)
-- ────────────────────────────────────────────────────────────

-- Core financial
REVOKE SELECT ON TABLE public.payments                        FROM anon;
REVOKE SELECT ON TABLE public.transactions                    FROM anon;
REVOKE SELECT ON TABLE public.payment_events                  FROM anon;
REVOKE SELECT ON TABLE public.payment_intents                 FROM anon;
REVOKE SELECT ON TABLE public.ledger_entries                  FROM anon;
REVOKE SELECT ON TABLE public.idempotency_keys                FROM anon;

-- Merchant config
REVOKE SELECT ON TABLE public.merchants                       FROM anon;
REVOKE SELECT ON TABLE public.merchant_settings               FROM anon;
REVOKE SELECT ON TABLE public.merchant_providers              FROM anon;
REVOKE SELECT ON TABLE public.merchant_wallets                FROM anon;
REVOKE SELECT ON TABLE public.wallet_balances                 FROM anon;

-- Sensitive credentials
REVOKE SELECT ON TABLE public.merchant_api_keys               FROM anon;
REVOKE SELECT ON TABLE public.merchant_webhooks               FROM anon;
REVOKE SELECT ON TABLE public.webhook_deliveries              FROM anon;
REVOKE SELECT ON TABLE public.merchant_credentials            FROM anon;
REVOKE SELECT ON TABLE public.merchant_exchange_connections   FROM anon;
REVOKE SELECT ON TABLE public.solflare_deeplink_sessions      FROM anon;
REVOKE SELECT ON TABLE public.wallet_connection_sessions      FROM anon;
REVOKE SELECT ON TABLE public.terminals                       FROM anon;

-- Checkout / settlement
REVOKE SELECT ON TABLE public.checkout_links                  FROM anon;
REVOKE SELECT ON TABLE public.merchant_settlement_destinations FROM anon;
REVOKE SELECT ON TABLE public.settlement_withdrawals          FROM anon;
REVOKE SELECT ON TABLE public.off_ramp_sessions               FROM anon;
REVOKE SELECT ON TABLE public.off_ramp_events                 FROM anon;
REVOKE SELECT ON TABLE public.wallet_operations               FROM anon;
REVOKE SELECT ON TABLE public.wallet_operation_events         FROM anon;
REVOKE SELECT ON TABLE public.merchant_wallet_send_sessions   FROM anon;

-- Support / POS
REVOKE SELECT ON TABLE public.support_tickets                 FROM anon;
REVOKE SELECT ON TABLE public.support_ticket_messages         FROM anon;
REVOKE SELECT ON TABLE public.merchant_feedback               FROM anon;
REVOKE SELECT ON TABLE public.locations                       FROM anon;
REVOKE SELECT ON TABLE public.devices                         FROM anon;
REVOKE SELECT ON TABLE public.cash_drawer_log                 FROM anon;
REVOKE SELECT ON TABLE public.routing_rules                   FROM anon;
REVOKE SELECT ON TABLE public.system_status                   FROM anon;

-- Revoke write grants from anon on all tables
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payments                        FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.transactions                    FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_events                  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_intents                 FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ledger_entries                  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchants                       FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_settings               FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_providers              FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_wallets                FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_balances                 FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_api_keys               FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_webhooks               FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.webhook_deliveries              FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_credentials            FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_exchange_connections   FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.solflare_deeplink_sessions      FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_connection_sessions      FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_links                  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_settlement_destinations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.settlement_withdrawals          FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.off_ramp_sessions               FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.off_ramp_events                 FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_operations               FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_operation_events         FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_wallet_send_sessions   FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.support_tickets                 FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.support_ticket_messages         FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_feedback               FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.locations                       FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.devices                         FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.terminals                       FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cash_drawer_log                 FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.routing_rules                   FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.system_status                   FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.idempotency_keys                FROM anon;

-- Revoke write grants from authenticated on all tables
-- (all writes go through API routes using service_role)
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payments                        FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.transactions                    FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_events                  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_intents                 FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ledger_entries                  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchants                       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_settings               FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_providers              FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_wallets                FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_balances                 FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_api_keys               FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_webhooks               FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.webhook_deliveries              FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_credentials            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_exchange_connections   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.solflare_deeplink_sessions      FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_connection_sessions      FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_links                  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_settlement_destinations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.settlement_withdrawals          FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.off_ramp_sessions               FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.off_ramp_events                 FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_operations               FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_operation_events         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_wallet_send_sessions   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.support_tickets                 FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.support_ticket_messages         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_feedback               FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.locations                       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.devices                         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.terminals                       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cash_drawer_log                 FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.routing_rules                   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.system_status                   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.idempotency_keys                FROM authenticated;

-- Revoke SELECT from authenticated on sensitive/credential tables
-- (no app code reads these via authenticated PostgREST — service_role only)
REVOKE SELECT ON TABLE public.merchant_api_keys               FROM authenticated;
REVOKE SELECT ON TABLE public.merchant_webhooks               FROM authenticated;
REVOKE SELECT ON TABLE public.webhook_deliveries              FROM authenticated;
REVOKE SELECT ON TABLE public.merchant_credentials            FROM authenticated;
REVOKE SELECT ON TABLE public.merchant_providers              FROM authenticated;
REVOKE SELECT ON TABLE public.merchant_exchange_connections   FROM authenticated;
REVOKE SELECT ON TABLE public.solflare_deeplink_sessions      FROM authenticated;
REVOKE SELECT ON TABLE public.wallet_connection_sessions      FROM authenticated;
REVOKE SELECT ON TABLE public.terminals                       FROM authenticated;
REVOKE SELECT ON TABLE public.payment_events                  FROM authenticated;
REVOKE SELECT ON TABLE public.idempotency_keys                FROM authenticated;
REVOKE SELECT ON TABLE public.off_ramp_events                 FROM authenticated;
REVOKE SELECT ON TABLE public.wallet_operation_events         FROM authenticated;
REVOKE SELECT ON TABLE public.merchant_feedback               FROM authenticated;
REVOKE SELECT ON TABLE public.system_status                   FROM authenticated;


-- ────────────────────────────────────────────────────────────
-- STEP 3 — Add least-privilege SELECT policies for
--           non-sensitive merchant-owned tables
--           (defence-in-depth: authenticated user sees only
--            their own merchant rows even if they hit
--            PostgREST directly)
-- ────────────────────────────────────────────────────────────

-- merchants: own record only
CREATE POLICY "merchants_select_own"
  ON public.merchants FOR SELECT TO authenticated
  USING (id = auth.uid());

-- payments
CREATE POLICY "payments_select_own"
  ON public.payments FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- transactions
CREATE POLICY "transactions_select_own"
  ON public.transactions FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- payment_intents
CREATE POLICY "payment_intents_select_own"
  ON public.payment_intents FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- ledger_entries
CREATE POLICY "ledger_entries_select_own"
  ON public.ledger_entries FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- merchant_settings
CREATE POLICY "merchant_settings_select_own"
  ON public.merchant_settings FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- merchant_tax_settings (may not exist in all deployments — guard with DO block)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'merchant_tax_settings'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "merchant_tax_settings_select_own"
        ON public.merchant_tax_settings FOR SELECT TO authenticated
        USING (merchant_id = auth.uid())
    $pol$;
  END IF;
END
$$;

-- merchant_wallets
CREATE POLICY "merchant_wallets_select_own"
  ON public.merchant_wallets FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- wallet_balances
CREATE POLICY "wallet_balances_select_own"
  ON public.wallet_balances FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- checkout_links
CREATE POLICY "checkout_links_select_own"
  ON public.checkout_links FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- merchant_settlement_destinations
CREATE POLICY "merchant_settlement_destinations_select_own"
  ON public.merchant_settlement_destinations FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- settlement_withdrawals
CREATE POLICY "settlement_withdrawals_select_own"
  ON public.settlement_withdrawals FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- settlement_preferences (if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'settlement_preferences'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'settlement_preferences'
        AND column_name = 'merchant_id'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY "settlement_preferences_select_own"
          ON public.settlement_preferences FOR SELECT TO authenticated
          USING (merchant_id = auth.uid())
      $pol$;
    END IF;
  END IF;
END
$$;

-- off_ramp_sessions
CREATE POLICY "off_ramp_sessions_select_own"
  ON public.off_ramp_sessions FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- wallet_operations
CREATE POLICY "wallet_operations_select_own"
  ON public.wallet_operations FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- merchant_wallet_send_sessions
CREATE POLICY "merchant_wallet_send_sessions_select_own"
  ON public.merchant_wallet_send_sessions FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- support_tickets
CREATE POLICY "support_tickets_select_own"
  ON public.support_tickets FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- support_ticket_messages
CREATE POLICY "support_ticket_messages_select_own"
  ON public.support_ticket_messages FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- locations
CREATE POLICY "locations_select_own"
  ON public.locations FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- devices
CREATE POLICY "devices_select_own"
  ON public.devices FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- cash_drawer_log
CREATE POLICY "cash_drawer_log_select_own"
  ON public.cash_drawer_log FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- routing_rules
CREATE POLICY "routing_rules_select_own"
  ON public.routing_rules FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- Sensitive / service-role-only tables — NO policies created
-- (default-deny enforced by RLS + no policy = zero access
--  for anon and authenticated; service_role bypasses RLS)
--
-- Tables: merchant_providers (credentials JSONB with NWC URIs,
--   Speed account IDs), merchant_api_keys (key_hash),
--   merchant_webhooks (secret), merchant_credentials (raw values),
--   merchant_exchange_connections (mesh_auth_token_id),
--   solflare_deeplink_sessions (dapp_secret_key byte array),
--   terminals (pin), wallet_connection_sessions,
--   payment_events, idempotency_keys, off_ramp_events,
--   wallet_operation_events, webhook_deliveries,
--   merchant_feedback (admin-read-only), system_status
-- ────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────
-- STEP 4 — Verification queries (run after migration)
-- ────────────────────────────────────────────────────────────

-- Query A: Any public table still without RLS?
--   SELECT relname FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--     AND c.relrowsecurity = false;
--   Expected: 0 rows

-- Query B: Policies created
--   SELECT tablename, policyname, cmd, roles
--   FROM pg_policies WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;

-- Query C: Sensitive column exposure check
--   SELECT table_name, column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND (column_name ILIKE '%secret%' OR column_name ILIKE '%key%'
--          OR column_name ILIKE '%token%' OR column_name ILIKE '%credential%'
--          OR column_name ILIKE '%password%' OR column_name ILIKE '%pin%')
--   ORDER BY table_name, column_name;
--   (All these tables should now have RLS enabled + no anon/authenticated policy)


-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
