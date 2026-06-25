-- Production repair for PineTree Wallet withdrawal requests.
-- Safe to run after earlier withdrawal migrations or against a partially updated
-- Supabase project. This does not drop or rename existing data.
ALTER TABLE wallet_withdrawal_requests
  ADD COLUMN IF NOT EXISTS asset TEXT NOT NULL DEFAULT 'ETH',
  ADD COLUMN IF NOT EXISTS amount_decimal TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS review_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS unsigned_transaction_payload JSONB,
  ADD COLUMN IF NOT EXISTS signed_payload JSONB,
  ADD COLUMN IF NOT EXISTS approval_method TEXT,
  ADD COLUMN IF NOT EXISTS chain_id TEXT,
  ADD COLUMN IF NOT EXISTS token_contract TEXT,
  ADD COLUMN IF NOT EXISTS token_mint TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'wallet_withdrawal_requests'
      AND column_name = 'amount'
  ) THEN
    UPDATE wallet_withdrawal_requests
    SET amount_decimal = COALESCE(amount_decimal, amount::TEXT, '0')
    WHERE amount_decimal IS NULL;
  ELSE
    UPDATE wallet_withdrawal_requests
    SET amount_decimal = COALESCE(amount_decimal, '0')
    WHERE amount_decimal IS NULL;
  END IF;
END $$;

ALTER TABLE wallet_withdrawal_requests
  ALTER COLUMN amount_decimal SET NOT NULL;

CREATE INDEX IF NOT EXISTS wallet_withdrawal_requests_merchant_status_idx
  ON wallet_withdrawal_requests (merchant_id, status);

CREATE INDEX IF NOT EXISTS wallet_withdrawal_requests_merchant_approval_idx
  ON wallet_withdrawal_requests (merchant_id, approval_method, status);

-- After applying this in Supabase, refresh the PostgREST schema cache:
-- NOTIFY pgrst, 'reload schema';
