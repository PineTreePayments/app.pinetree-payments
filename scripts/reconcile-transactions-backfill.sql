-- ============================================================
-- PineTree Payments — Transaction / payment reconciliation backfill
-- Date: 2026-06-06
--
-- ONE-TIME script to fix rows that diverged before the reconciliation
-- logic was added (engine/reconcileTransaction.ts + sweep migration).
--
-- DO NOT run this automatically.  Review the diagnostic output first,
-- confirm the counts look right, then run within a transaction so you
-- can ROLLBACK if something is unexpected.
--
-- Run order:
--   1. diagnostic queries (SELECT only)
--   2. BEGIN
--   3. backfill queries
--   4. verify queries
--   5. COMMIT (or ROLLBACK)
-- ============================================================


-- ── Step 1: Diagnostic — identify mismatched rows ─────────────────────────────

-- How many transactions are non-terminal but the payment is terminal?
-- Expected: 0 after the fix is applied and the backfill has run.
SELECT
  t.status  AS transaction_status,
  p.status  AS payment_status,
  COUNT(*)  AS count
FROM transactions t
JOIN payments p ON p.id = t.payment_id
WHERE t.status IN ('PENDING', 'PROCESSING', 'CREATED')
  AND p.status IN ('CONFIRMED', 'FAILED', 'INCOMPLETE', 'EXPIRED', 'CANCELLED')
GROUP BY t.status, p.status
ORDER BY t.status, p.status;


-- Full current transaction status distribution
SELECT status, COUNT(*) AS count
FROM transactions
GROUP BY status
ORDER BY status;


-- ── Step 2: Backfill ─────────────────────────────────────────────────────────

BEGIN;

-- 2a: transactions PENDING/PROCESSING/CREATED → CONFIRMED
--     where payment is CONFIRMED.
--     CONFIRMED is authoritative regardless of provider_transaction_id.
UPDATE transactions t
SET    status     = 'CONFIRMED',
       updated_at = now()
FROM   payments p
WHERE  t.payment_id = p.id
  AND  p.status     = 'CONFIRMED'
  AND  t.status     IN ('PENDING', 'PROCESSING', 'CREATED');

-- 2b: transactions PENDING/PROCESSING/CREATED → FAILED
--     where payment is FAILED and the transaction has NO provider_transaction_id.
--     (Transactions with a provider_transaction_id might have on-chain evidence
--      from a partially-broadcast attempt — leave those alone.)
UPDATE transactions t
SET    status     = 'FAILED',
       updated_at = now()
FROM   payments p
WHERE  t.payment_id = p.id
  AND  p.status     = 'FAILED'
  AND  t.status     IN ('PENDING', 'PROCESSING', 'CREATED')
  AND  (t.provider_transaction_id IS NULL OR trim(t.provider_transaction_id) = '');

-- 2c: transactions PENDING/PROCESSING → INCOMPLETE
--     where payment is INCOMPLETE, EXPIRED, or CANCELLED and the transaction has NO provider_transaction_id.
--     INCOMPLETE is the production-standard abandoned/unresolved state for transactions.
--     EXPIRED and CANCELLED payments have no dedicated transaction state and map to INCOMPLETE.
UPDATE transactions t
SET    status     = 'INCOMPLETE',
       updated_at = now()
FROM   payments p
WHERE  t.payment_id = p.id
  AND  p.status     IN ('INCOMPLETE', 'EXPIRED', 'CANCELLED')
  AND  t.status     IN ('PENDING', 'PROCESSING', 'CREATED')
  AND  (t.provider_transaction_id IS NULL OR trim(t.provider_transaction_id) = '');

-- ── Step 3: Verify ───────────────────────────────────────────────────────────

-- This query should return 0 rows after the backfill succeeds.
SELECT
  t.status  AS transaction_status,
  p.status  AS payment_status,
  COUNT(*)  AS count
FROM transactions t
JOIN payments p ON p.id = t.payment_id
WHERE t.status IN ('PENDING', 'PROCESSING', 'CREATED')
  AND p.status IN ('CONFIRMED', 'FAILED', 'INCOMPLETE', 'EXPIRED', 'CANCELLED')
GROUP BY t.status, p.status
ORDER BY t.status, p.status;

-- Updated transaction status distribution (compare with Step 1 baseline).
SELECT status, COUNT(*) AS count
FROM transactions
GROUP BY status
ORDER BY status;

-- ── Step 4: Commit or rollback ───────────────────────────────────────────────

-- If the Step 3 queries look correct:
COMMIT;

-- If anything looks wrong:
-- ROLLBACK;
