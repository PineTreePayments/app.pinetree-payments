-- Store Speed Custom Connect ids separately.
-- speed_connected_account_relationship_id is the ca_ relationship id returned
-- as "id"; speed_account_id is the connected merchant account_id required for
-- payment creation and connected-account webhook routing.
ALTER TABLE merchant_lightning_profiles
  ADD COLUMN IF NOT EXISTS speed_connected_account_relationship_id TEXT,
  ADD COLUMN IF NOT EXISTS speed_account_id TEXT;

UPDATE merchant_lightning_profiles
SET speed_account_id = speed_connected_account_id
WHERE speed_account_id IS NULL
  AND speed_connected_account_id IS NOT NULL
  AND speed_connected_account_id NOT LIKE 'ca\_%' ESCAPE '\';

UPDATE merchant_lightning_profiles
SET speed_connected_account_relationship_id = speed_connected_account_id
WHERE speed_connected_account_relationship_id IS NULL
  AND speed_connected_account_id LIKE 'ca\_%' ESCAPE '\';

CREATE INDEX IF NOT EXISTS merchant_lightning_profiles_speed_account_id_idx
  ON merchant_lightning_profiles (speed_account_id);

CREATE INDEX IF NOT EXISTS merchant_lightning_profiles_speed_relationship_id_idx
  ON merchant_lightning_profiles (speed_connected_account_relationship_id);

CREATE INDEX IF NOT EXISTS payment_events_provider_event_idx
  ON payment_events (provider_event)
  WHERE provider_event IS NOT NULL AND provider_event <> '';
