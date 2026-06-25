-- PineTree Wallet withdrawal review foundation.
-- Adds the fields needed to create safe review records without broadcasting funds.
ALTER TABLE wallet_withdrawal_requests
  ADD COLUMN IF NOT EXISTS asset TEXT NOT NULL DEFAULT 'ETH',
  ADD COLUMN IF NOT EXISTS amount_decimal TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS review_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

UPDATE wallet_withdrawal_requests
SET amount_decimal = COALESCE(amount_decimal, amount::TEXT, '0')
WHERE amount_decimal IS NULL;

UPDATE wallet_withdrawal_requests
SET status = CASE status
  WHEN 'pending_review' THEN 'review_required'
  WHEN 'disabled' THEN 'blocked'
  WHEN 'completed' THEN 'confirmed'
  WHEN 'cancelled' THEN 'canceled'
  ELSE status
END;

ALTER TABLE wallet_withdrawal_requests
  ALTER COLUMN amount_decimal SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE wallet_withdrawal_requests
  DROP CONSTRAINT IF EXISTS wallet_withdrawal_requests_status_check;

ALTER TABLE wallet_withdrawal_requests
  ADD CONSTRAINT wallet_withdrawal_requests_status_check
  CHECK (status IN (
    'draft',
    'review_required',
    'blocked',
    'pending',
    'processing',
    'confirmed',
    'failed',
    'canceled'
  ));

CREATE INDEX IF NOT EXISTS wallet_withdrawal_requests_merchant_status_idx
  ON wallet_withdrawal_requests (merchant_id, status);
