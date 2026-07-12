-- Speed has not yet confirmed whether the X-Speed-Account header expects the
-- ca_ relationship id or the acct_ connected-account id (see
-- providers/lightning/speedHeaderAccountResolver.ts). speed_header_account_id
-- is a separate, deliberately-nullable field from speed_account_id /
-- speed_connected_account_relationship_id - it is never auto-populated from
-- either. It is only ever set once Speed's documentation (or a confirmed
-- support response) settles the exact identifier format, at which point an
-- administrator (or a follow-up migration) backfills it. Until then it stays
-- NULL and every outbound Speed Instant Send call fails closed.
ALTER TABLE merchant_lightning_profiles
  ADD COLUMN IF NOT EXISTS speed_header_account_id TEXT;

COMMENT ON COLUMN merchant_lightning_profiles.speed_header_account_id IS
  'Provider-confirmed X-Speed-Account header value for Instant Send calls. NULL until Speed confirms the ca_ vs acct_ identifier format - never inferred automatically.';
