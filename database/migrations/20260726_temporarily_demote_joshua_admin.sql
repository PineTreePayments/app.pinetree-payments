BEGIN;

-- Temporary admin access update:
-- Jordan is the sole official PineTree admin for now. Joshua's merchant row
-- remains intact and keeps normal merchant access.
UPDATE public.merchants
SET role = 'admin'
WHERE lower(trim(COALESCE(email, ''))) = 'jordanduskin@gmail.com';

UPDATE public.merchants
SET role = 'merchant'
WHERE lower(trim(COALESCE(role, ''))) IN (
  'admin',
  'super_admin',
  'developer',
  'staff',
  'support'
)
AND lower(trim(COALESCE(email, ''))) <> 'jordanduskin@gmail.com';

COMMIT;
