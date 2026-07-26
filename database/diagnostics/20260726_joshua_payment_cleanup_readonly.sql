-- Read-only Joshua payment cleanup discovery.
-- Safe to run in Supabase SQL editor. This does not delete or update data.

-- 1. Target merchant row.
WITH target_merchant AS (
  SELECT id, email, role, business_name, created_at, updated_at
  FROM public.merchants
  WHERE lower(trim(COALESCE(email, ''))) = 'joshuaduskin@outlook.com'
)
SELECT * FROM target_merchant;

-- 2. Existing table/column inventory for payment-related tables.
SELECT
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN (
  'payments',
  'transactions',
  'payment_events',
  'ledger_entries',
  'payment_intents',
  'idempotency_keys',
  'solflare_deeplink_sessions',
  'merchant_terminal_readers',
  'lightning_payout_jobs',
  'lightning_settlement_payout_jobs',
  'merchant_lightning_sweeps',
  'support_tickets'
)
ORDER BY table_name, ordinal_position;

-- 3. FK/cascade inventory. Review this before writing destructive cleanup SQL.
SELECT
  src_ns.nspname AS source_schema,
  src.relname AS source_table,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE con.confdeltype::text
  END AS on_delete
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
LEFT JOIN pg_class ref ON ref.oid = con.confrelid
LEFT JOIN pg_namespace ref_ns ON ref_ns.oid = ref.relnamespace
WHERE con.contype = 'f'
AND src_ns.nspname = 'public'
AND (
  src.relname IN (
    'payments',
    'transactions',
    'payment_events',
    'ledger_entries',
    'payment_intents',
    'idempotency_keys',
    'solflare_deeplink_sessions',
    'merchant_terminal_readers',
    'lightning_payout_jobs',
    'lightning_settlement_payout_jobs',
    'merchant_lightning_sweeps',
    'support_tickets'
  )
  OR ref.relname = 'payments'
)
ORDER BY source_table, constraint_name;

-- 4. Grouped payment counts by raw status for Joshua only.
WITH target_merchant AS (
  SELECT id
  FROM public.merchants
  WHERE lower(trim(COALESCE(email, ''))) = 'joshuaduskin@outlook.com'
),
scoped_payments AS (
  SELECT p.*
  FROM public.payments p
  JOIN target_merchant tm ON tm.id = p.merchant_id
)
SELECT
  COALESCE(NULLIF(trim(status), ''), '(blank)') AS raw_status,
  CASE
    WHEN upper(trim(COALESCE(status, ''))) IN ('CONFIRMED', 'SUCCESS', 'SUCCEEDED', 'COMPLETE', 'COMPLETED', 'PAID') THEN 'preserve_success'
    WHEN upper(trim(COALESCE(status, ''))) IN ('CREATED', 'PENDING', 'WAITING', 'AWAITING_CUSTOMER', 'AWAITING_CONFIRMATION') THEN 'active_waiting'
    WHEN upper(trim(COALESCE(status, ''))) IN ('PROCESSING', 'IN_PROGRESS', 'SETTLING', 'SUBMITTED', 'SENT') THEN 'active_processing'
    WHEN upper(trim(COALESCE(status, ''))) IN ('FAILED', 'ERROR', 'REJECTED', 'DECLINED', 'DENIED') THEN 'cleanup_candidate_failed'
    WHEN upper(trim(COALESCE(status, ''))) IN ('INCOMPLETE', 'ABANDONED', 'REQUIRES_ACTION', 'ACTION_REQUIRED') THEN 'cleanup_candidate_incomplete'
    WHEN upper(trim(COALESCE(status, ''))) IN ('EXPIRED', 'TIMED_OUT', 'TIMEOUT') THEN 'cleanup_candidate_expired'
    WHEN upper(trim(COALESCE(status, ''))) IN ('CANCELED', 'CANCELLED') THEN 'cleanup_candidate_canceled'
    WHEN upper(trim(COALESCE(status, ''))) IN ('REFUNDED') THEN 'review_refunded'
    ELSE 'review_unknown'
  END AS cleanup_bucket,
  COUNT(*) AS payment_count,
  MIN(created_at) AS oldest_created_at,
  MAX(created_at) AS newest_created_at,
  SUM(COALESCE(gross_amount, 0)) AS gross_amount_total
FROM scoped_payments
GROUP BY raw_status, cleanup_bucket
ORDER BY cleanup_bucket, raw_status;

-- 5. Candidate preview with related-row counts. Review rows with evidence
-- columns before approving any future cleanup.
WITH target_merchant AS (
  SELECT id
  FROM public.merchants
  WHERE lower(trim(COALESCE(email, ''))) = 'joshuaduskin@outlook.com'
),
scoped_payments AS (
  SELECT p.*
  FROM public.payments p
  JOIN target_merchant tm ON tm.id = p.merchant_id
),
relation_counts AS (
  SELECT
    p.id AS payment_id,
    (SELECT COUNT(*) FROM public.transactions t WHERE t.payment_id = p.id) AS transaction_count,
    (SELECT COUNT(*) FROM public.transactions t WHERE t.payment_id = p.id AND upper(trim(COALESCE(t.status, ''))) IN ('CONFIRMED', 'SUCCESS', 'SUCCEEDED', 'COMPLETE', 'COMPLETED', 'PAID')) AS confirmed_transaction_count,
    (SELECT COUNT(*) FROM public.transactions t WHERE t.payment_id = p.id AND NULLIF(trim(COALESCE(t.provider_transaction_id, '')), '') IS NOT NULL) AS provider_transaction_reference_count,
    (SELECT COUNT(*) FROM public.payment_events e WHERE e.payment_id = p.id) AS payment_event_count,
    (SELECT COUNT(*) FROM public.payment_events e WHERE e.payment_id = p.id AND e.event_type IN ('payment.pending', 'payment.processing', 'payment.confirmed', 'payment.reconciled')) AS processing_or_success_event_count,
    (SELECT COUNT(*) FROM public.ledger_entries l WHERE l.payment_id = p.id) AS ledger_entry_count,
    (SELECT COUNT(*) FROM public.payment_intents i WHERE i.payment_id = p.id) AS payment_intent_count,
    (SELECT COUNT(*) FROM public.idempotency_keys k WHERE k.payment_id = p.id) AS idempotency_key_count,
    (SELECT COUNT(*) FROM public.solflare_deeplink_sessions s WHERE s.payment_id = p.id) AS solflare_deeplink_count,
    (SELECT COUNT(*) FROM public.merchant_terminal_readers r WHERE r.active_payment_id = p.id) AS active_terminal_reader_count,
    (SELECT COUNT(*) FROM public.lightning_payout_jobs j WHERE j.payment_id = p.id) AS lightning_payout_job_count,
    (SELECT COUNT(*) FROM public.lightning_settlement_payout_jobs j WHERE j.payment_id = p.id) AS lightning_settlement_job_count,
    (SELECT COUNT(*) FROM public.merchant_lightning_sweeps s WHERE s.source_payment_id = p.id) AS merchant_lightning_sweep_count,
    (SELECT COUNT(*) FROM public.support_tickets st WHERE st.related_payment_id = p.id) AS support_ticket_count
  FROM scoped_payments p
),
classified AS (
  SELECT
    p.id,
    p.merchant_id,
    p.created_at,
    p.updated_at,
    p.status,
    p.network,
    p.provider,
    p.provider_reference,
    p.currency,
    p.gross_amount,
    p.merchant_amount,
    p.pinetree_fee,
    rc.*,
    CASE
      WHEN upper(trim(COALESCE(p.status, ''))) IN ('CONFIRMED', 'SUCCESS', 'SUCCEEDED', 'COMPLETE', 'COMPLETED', 'PAID') THEN 'preserve_success'
      WHEN upper(trim(COALESCE(p.status, ''))) IN ('FAILED', 'ERROR', 'REJECTED', 'DECLINED', 'DENIED', 'INCOMPLETE', 'ABANDONED', 'REQUIRES_ACTION', 'ACTION_REQUIRED', 'EXPIRED', 'TIMED_OUT', 'TIMEOUT', 'CANCELED', 'CANCELLED') THEN 'candidate_unsuccessful_terminal'
      WHEN upper(trim(COALESCE(p.status, ''))) IN ('CREATED', 'WAITING', 'AWAITING_CUSTOMER', 'AWAITING_CONFIRMATION')
        AND p.updated_at < now() - interval '30 minutes' THEN 'candidate_stale_waiting_review'
      WHEN upper(trim(COALESCE(p.status, ''))) = 'PENDING'
        AND p.updated_at < now() - interval '60 minutes' THEN 'candidate_stale_pending_review'
      WHEN upper(trim(COALESCE(p.status, ''))) IN ('PROCESSING', 'IN_PROGRESS', 'SETTLING', 'SUBMITTED', 'SENT')
        AND p.updated_at < now() - interval '24 hours' THEN 'manual_review_stale_processing'
      WHEN upper(trim(COALESCE(p.status, ''))) = 'REFUNDED' THEN 'manual_review_refunded'
      ELSE 'do_not_delete_or_manual_review'
    END AS candidate_bucket
  FROM scoped_payments p
  JOIN relation_counts rc ON rc.payment_id = p.id
)
SELECT
  *,
  (
    confirmed_transaction_count > 0
    OR provider_transaction_reference_count > 0
    OR processing_or_success_event_count > 0
    OR ledger_entry_count > 0
    OR lightning_payout_job_count > 0
    OR lightning_settlement_job_count > 0
    OR merchant_lightning_sweep_count > 0
    OR support_ticket_count > 0
    OR active_terminal_reader_count > 0
  ) AS has_financial_or_manual_review_evidence
FROM classified
WHERE candidate_bucket LIKE 'candidate_%'
OR candidate_bucket LIKE 'manual_review_%'
ORDER BY has_financial_or_manual_review_evidence DESC, updated_at ASC, created_at ASC;

-- 6. Candidate bucket totals from the same classification.
WITH target_merchant AS (
  SELECT id
  FROM public.merchants
  WHERE lower(trim(COALESCE(email, ''))) = 'joshuaduskin@outlook.com'
),
scoped_payments AS (
  SELECT p.*
  FROM public.payments p
  JOIN target_merchant tm ON tm.id = p.merchant_id
)
SELECT
  CASE
    WHEN upper(trim(COALESCE(status, ''))) IN ('CONFIRMED', 'SUCCESS', 'SUCCEEDED', 'COMPLETE', 'COMPLETED', 'PAID') THEN 'preserve_success'
    WHEN upper(trim(COALESCE(status, ''))) IN ('FAILED', 'ERROR', 'REJECTED', 'DECLINED', 'DENIED', 'INCOMPLETE', 'ABANDONED', 'REQUIRES_ACTION', 'ACTION_REQUIRED', 'EXPIRED', 'TIMED_OUT', 'TIMEOUT', 'CANCELED', 'CANCELLED') THEN 'candidate_unsuccessful_terminal'
    WHEN upper(trim(COALESCE(status, ''))) IN ('CREATED', 'WAITING', 'AWAITING_CUSTOMER', 'AWAITING_CONFIRMATION')
      AND updated_at < now() - interval '30 minutes' THEN 'candidate_stale_waiting_review'
    WHEN upper(trim(COALESCE(status, ''))) = 'PENDING'
      AND updated_at < now() - interval '60 minutes' THEN 'candidate_stale_pending_review'
    WHEN upper(trim(COALESCE(status, ''))) IN ('PROCESSING', 'IN_PROGRESS', 'SETTLING', 'SUBMITTED', 'SENT')
      AND updated_at < now() - interval '24 hours' THEN 'manual_review_stale_processing'
    WHEN upper(trim(COALESCE(status, ''))) = 'REFUNDED' THEN 'manual_review_refunded'
    ELSE 'do_not_delete_or_manual_review'
  END AS candidate_bucket,
  COUNT(*) AS payment_count,
  MIN(updated_at) AS oldest_updated_at,
  MAX(updated_at) AS newest_updated_at
FROM scoped_payments
GROUP BY candidate_bucket
ORDER BY candidate_bucket;

-- 7. Post-cleanup verification query to run after a future approved cleanup.
-- Expected: confirmed/completed rows are unchanged; only approved unsuccessful
-- or stale candidate counts should decrease.
WITH target_merchant AS (
  SELECT id
  FROM public.merchants
  WHERE lower(trim(COALESCE(email, ''))) = 'joshuaduskin@outlook.com'
)
SELECT
  p.status,
  COUNT(*) AS payment_count,
  MIN(p.created_at) AS oldest_created_at,
  MAX(p.created_at) AS newest_created_at
FROM public.payments p
JOIN target_merchant tm ON tm.id = p.merchant_id
GROUP BY p.status
ORDER BY p.status;
