ALTER TABLE public.merchant_providers
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.merchant_providers
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

NOTIFY pgrst, 'reload schema';
