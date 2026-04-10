-- Add gross_amount required by payment creation flow
-- Safe to run multiple times

alter table public.payments
  add column if not exists gross_amount numeric;

-- Backfill existing rows where possible
update public.payments
set gross_amount = coalesce(merchant_amount, 0) + coalesce(pinetree_fee, 0)
where gross_amount is null;

-- Default for new rows
alter table public.payments
  alter column gross_amount set default 0;

-- Reload PostgREST schema cache so API can see new column immediately
select pg_notify('pgrst', 'reload schema');
