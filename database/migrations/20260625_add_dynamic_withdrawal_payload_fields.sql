-- PineTree Wallet Dynamic browser-approved withdrawal payload tracking.
-- Stores unsigned transaction metadata and post-approval references only.
ALTER TABLE wallet_withdrawal_requests
  ADD COLUMN IF NOT EXISTS unsigned_transaction_payload JSONB,
  ADD COLUMN IF NOT EXISTS signed_payload JSONB,
  ADD COLUMN IF NOT EXISTS approval_method TEXT,
  ADD COLUMN IF NOT EXISTS chain_id TEXT,
  ADD COLUMN IF NOT EXISTS token_contract TEXT,
  ADD COLUMN IF NOT EXISTS token_mint TEXT;

CREATE INDEX IF NOT EXISTS wallet_withdrawal_requests_merchant_approval_idx
  ON wallet_withdrawal_requests (merchant_id, approval_method, status);
