ALTER TABLE settlement_withdrawals
  ALTER COLUMN settlement_destination_id DROP NOT NULL;

ALTER TABLE settlement_withdrawals
  ADD COLUMN IF NOT EXISTS movement_type text NOT NULL DEFAULT 'saved_destination_withdrawal',
  ADD COLUMN IF NOT EXISTS destination_kind text;

UPDATE settlement_withdrawals
SET
  movement_type = COALESCE(NULLIF(movement_type, ''), 'saved_destination_withdrawal'),
  destination_kind = COALESCE(NULLIF(destination_kind, ''), 'saved_destination')
WHERE movement_type IS NULL
   OR movement_type = ''
   OR destination_kind IS NULL
   OR destination_kind = '';

CREATE UNIQUE INDEX IF NOT EXISTS settlement_withdrawals_merchant_tx_hash_unique
  ON settlement_withdrawals (merchant_id, tx_hash)
  WHERE tx_hash IS NOT NULL AND tx_hash <> '';
