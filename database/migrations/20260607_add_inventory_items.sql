-- Minimal merchant inventory foundation for PineTree POS.
-- Inventory is merchant-owned and managed through authenticated API routes.

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  name text NOT NULL,
  sku text,
  category text,
  price numeric(14, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  cost numeric(14, 2) CHECK (cost IS NULL OR cost >= 0),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  image_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_items_merchant_updated_idx
  ON public.inventory_items (merchant_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_merchant_sku_unique
  ON public.inventory_items (merchant_id, lower(sku))
  WHERE sku IS NOT NULL AND btrim(sku) <> '';

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inventory_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory_items FROM authenticated;
GRANT SELECT ON TABLE public.inventory_items TO authenticated;

DROP POLICY IF EXISTS "inventory_items_select_own" ON public.inventory_items;
CREATE POLICY "inventory_items_select_own"
  ON public.inventory_items FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());

NOTIFY pgrst, 'reload schema';
