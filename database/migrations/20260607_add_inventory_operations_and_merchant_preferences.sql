-- Merchant inventory operations and persisted dashboard preferences.

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'CREATE', 'ADJUST', 'SALE', 'RETURN', 'ARCHIVE', 'RESTORE', 'IMPORT', 'SYNC'
  )),
  quantity_delta integer NOT NULL DEFAULT 0,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_merchant_created_idx
  ON public.inventory_movements (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_item_created_idx
  ON public.inventory_movements (item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'AVAILABLE', 'CONNECTED', 'ERROR', 'DISABLED')),
  last_sync_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, provider)
);

CREATE INDEX IF NOT EXISTS inventory_integrations_merchant_idx
  ON public.inventory_integrations (merchant_id);

ALTER TABLE public.merchant_settings
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS address_line_2 text,
  ADD COLUMN IF NOT EXISTS website text;

CREATE TABLE IF NOT EXISTS public.merchant_operations_settings (
  merchant_id uuid PRIMARY KEY,
  show_business_name boolean NOT NULL DEFAULT true,
  show_business_address boolean NOT NULL DEFAULT true,
  show_transaction_id boolean NOT NULL DEFAULT true,
  show_network boolean NOT NULL DEFAULT true,
  show_provider boolean NOT NULL DEFAULT true,
  show_wallet_reference boolean NOT NULL DEFAULT false,
  receipt_footer text,
  auto_print boolean NOT NULL DEFAULT false,
  email_receipt_enabled boolean NOT NULL DEFAULT false,
  sms_receipt_enabled boolean NOT NULL DEFAULT false,
  cash_drawer_enabled boolean NOT NULL DEFAULT false,
  require_cashier_note boolean NOT NULL DEFAULT false,
  default_terminal_label text,
  receipt_prompt_after_payment boolean NOT NULL DEFAULT true,
  tipping_enabled boolean NOT NULL DEFAULT false,
  successful_payment_alerts boolean NOT NULL DEFAULT true,
  failed_payment_alerts boolean NOT NULL DEFAULT true,
  incomplete_payment_alerts boolean NOT NULL DEFAULT true,
  daily_summary boolean NOT NULL DEFAULT false,
  low_inventory_alerts boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_operations_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inventory_movements FROM anon;
REVOKE ALL ON TABLE public.inventory_integrations FROM anon;
REVOKE ALL ON TABLE public.merchant_operations_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory_movements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory_integrations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_operations_settings FROM authenticated;
GRANT SELECT ON TABLE public.inventory_movements TO authenticated;
GRANT SELECT ON TABLE public.inventory_integrations TO authenticated;
GRANT SELECT ON TABLE public.merchant_operations_settings TO authenticated;

DROP POLICY IF EXISTS "inventory_movements_select_own" ON public.inventory_movements;
CREATE POLICY "inventory_movements_select_own"
  ON public.inventory_movements FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

DROP POLICY IF EXISTS "inventory_integrations_select_own" ON public.inventory_integrations;
CREATE POLICY "inventory_integrations_select_own"
  ON public.inventory_integrations FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

DROP POLICY IF EXISTS "merchant_operations_settings_select_own" ON public.merchant_operations_settings;
CREATE POLICY "merchant_operations_settings_select_own"
  ON public.merchant_operations_settings FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

NOTIFY pgrst, 'reload schema';
