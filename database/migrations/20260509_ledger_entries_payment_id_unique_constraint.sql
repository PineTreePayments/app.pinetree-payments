-- PineTree Payments — Ledger Entry Idempotency Constraint Fix
--
-- Supabase/PostgREST upserts using onConflict: 'payment_id' require a non-partial
-- unique or exclusion constraint/index that exactly matches ON CONFLICT (payment_id).
-- The previous schema used a partial unique index WHERE payment_id IS NOT NULL,
-- which Postgres cannot infer for a plain ON CONFLICT (payment_id) upsert.
--
-- Unique indexes permit multiple NULL values in Postgres, so this preserves nullable
-- payment_id rows while enforcing one ledger entry per real payment.

create unique index if not exists ledger_entries_payment_id_on_conflict_idx
  on public.ledger_entries (payment_id);