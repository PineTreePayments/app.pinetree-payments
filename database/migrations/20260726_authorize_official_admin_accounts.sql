BEGIN;

WITH official_admin_emails(email) AS (
  VALUES
    ('joshuaduskin@outlook.com'),
    ('jordanduskin@gmail.com')
)
UPDATE public.merchants
SET role = 'admin'
WHERE lower(trim(COALESCE(email, ''))) IN (
  SELECT email FROM official_admin_emails
);

WITH official_admin_emails(email) AS (
  VALUES
    ('joshuaduskin@outlook.com'),
    ('jordanduskin@gmail.com')
)
UPDATE public.merchants
SET role = 'merchant'
WHERE lower(trim(COALESCE(role, ''))) IN ('admin', 'super_admin', 'developer', 'staff', 'support')
  AND lower(trim(COALESCE(email, ''))) NOT IN (
    SELECT email FROM official_admin_emails
  );

COMMIT;
