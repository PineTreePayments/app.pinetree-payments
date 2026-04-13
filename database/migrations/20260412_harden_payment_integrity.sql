-- Phase 2 hardening: canonical payment lookups + idempotency integrity + faster event reads

-- Normalize legacy idempotency column naming before enforcing uniqueness.
update public.idempotency_keys
set key = coalesce(nullif(key, ''), nullif(idempotency_key, ''))
where coalesce(nullif(key, ''), nullif(idempotency_key, '')) is not null;

create unique index if not exists idempotency_keys_key_unique_idx
  on public.idempotency_keys (key)
  where key is not null;

create index if not exists payments_provider_reference_idx
  on public.payments (provider_reference);

create index if not exists payment_events_payment_created_idx
  on public.payment_events (payment_id, created_at desc);

create index if not exists transactions_payment_id_idx
  on public.transactions (payment_id);

create index if not exists ledger_entries_payment_id_idx
  on public.ledger_entries (payment_id);

select pg_notify('pgrst', 'reload schema');