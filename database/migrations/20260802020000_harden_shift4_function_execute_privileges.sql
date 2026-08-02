-- Forward-only privilege correction for the four Shift4 foundation migrations
-- already installed in Supabase. This migration changes no data and replaces
-- no function. REVOKE and GRANT are idempotent for an already-correct target.
begin;

-- Internal trigger helpers are never direct application RPCs.
revoke all on function public.ledger_account_identity_is_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.shift4_tender_group_identity_is_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.shift4_tender_group_is_undeletable()
  from public, anon, authenticated, service_role;

-- Normalize backend RPC execution before restoring only service_role access.
revoke all on function public.create_shift4_payment_attempt(
  text, uuid, uuid, uuid, text, text, varchar, bigint, varchar,
  text, text, text, text, text, bigint, text, integer, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.claim_due_shift4_payment_attempts(
  text, integer, integer, uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.apply_shift4_attempt_evidence(
  uuid, text, integer, text, text, text, text, text, integer, integer,
  text, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, timestamptz, timestamptz, text, text, timestamptz, timestamptz,
  boolean, boolean, boolean, boolean, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.release_shift4_attempt_lease(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.create_shift4_payment_attempt(
  text, uuid, uuid, uuid, text, text, varchar, bigint, varchar,
  text, text, text, text, text, bigint, text, integer, text, text, text
) to service_role;
grant execute on function public.claim_due_shift4_payment_attempts(
  text, integer, integer, uuid, uuid, uuid, text, timestamptz
) to service_role;
grant execute on function public.apply_shift4_attempt_evidence(
  uuid, text, integer, text, text, text, text, text, integer, integer,
  text, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, timestamptz, timestamptz, text, text, timestamptz, timestamptz,
  boolean, boolean, boolean, boolean, text, text, text
) to service_role;
grant execute on function public.release_shift4_attempt_lease(uuid, text, text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';

commit;
