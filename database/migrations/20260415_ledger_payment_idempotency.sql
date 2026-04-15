-- Enforce exactly one ledger entry per payment.
-- Both the webhook processor and the blockchain watcher can confirm a payment;
-- this constraint ensures only the first write wins regardless of which path fires.
--
-- The existing ledger_entries_payment_id_idx (non-unique) is left in place —
-- PostgreSQL will use this unique index for all constraint checks automatically.
-- You can optionally drop the old index later via:
--   DROP INDEX IF EXISTS public.ledger_entries_payment_id_idx;

create unique index if not exists ledger_entries_payment_id_unique_idx
  on public.ledger_entries (payment_id)
  where payment_id is not null;

select pg_notify('pgrst', 'reload schema');
