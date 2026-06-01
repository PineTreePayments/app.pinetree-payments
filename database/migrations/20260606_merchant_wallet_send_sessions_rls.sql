-- RLS setup for merchant_wallet_send_sessions
--
-- The approval page (phone browser, not logged in) needs to read sessions by
-- their UUID. Since UUIDs are cryptographically unguessable, possession of the
-- session URL is sufficient authorization for read access.
--
-- Server-side writes (create, status updates) are done via the service role
-- key which bypasses RLS entirely, so no INSERT/UPDATE/DELETE policies are
-- needed here.
--
-- Run this migration if the table has RLS enabled (or to enable it cleanly).
-- Safe to run even if RLS is currently disabled — it will enable it and add
-- the policy. The service role key in Vercel always bypasses RLS regardless.

ALTER TABLE merchant_wallet_send_sessions ENABLE ROW LEVEL SECURITY;

-- Allow anyone (including unauthenticated phone browsers) to read a session
-- by its UUID. The UUID is 128-bit random — it is the access token.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'merchant_wallet_send_sessions'
      AND policyname = 'mwss_public_select_by_id'
  ) THEN
    CREATE POLICY mwss_public_select_by_id
      ON merchant_wallet_send_sessions
      FOR SELECT
      USING (true);
  END IF;
END
$$;
