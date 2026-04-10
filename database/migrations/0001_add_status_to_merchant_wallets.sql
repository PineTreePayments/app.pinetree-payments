-- ======================================================
-- PineTree Payments Database Migration 0001
-- Add status column to merchant_wallets table
--
-- Date: 2026-04-09
-- Description: Fix for mobile wallet scan save error
-- Enterprise-grade, idempotent, backwards compatible
-- ======================================================

BEGIN;

-- Add status column if it doesn't exist already
ALTER TABLE merchant_wallets 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'connected'::text;

-- Update existing records to have proper status
UPDATE merchant_wallets 
SET status = 'connected' 
WHERE status IS NULL;

-- Create index for query performance
CREATE INDEX IF NOT EXISTS idx_merchant_wallets_status 
ON merchant_wallets(status);

-- Add comment for documentation
COMMENT ON COLUMN merchant_wallets.status IS 'Wallet connection status: connected, disconnected, pending, failed';

COMMIT;