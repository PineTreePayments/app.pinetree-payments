-- DEPLOYMENT SQL BLOCK: merchant-local reporting configuration and indexes.
-- Apply through the production migration runner after backup/change review.
-- Merchant-local reporting configuration and indexes for the bounded,
-- merchant-scoped transaction/report query paths.

alter table public.merchant_settings
  add column if not exists timezone text not null default 'UTC';

comment on column public.merchant_settings.timezone is
  'IANA timezone used for merchant-local reporting boundaries. UTC is the explicit fallback.';

create index if not exists payments_merchant_created_idx
  on public.payments (merchant_id, created_at desc);

create index if not exists payments_merchant_status_created_idx
  on public.payments (merchant_id, status, created_at desc);

create index if not exists payments_merchant_provider_created_idx
  on public.payments (merchant_id, provider, created_at desc);

create index if not exists transactions_merchant_created_id_idx
  on public.transactions (merchant_id, created_at desc, id desc);

create index if not exists transactions_merchant_status_created_idx
  on public.transactions (merchant_id, status, created_at desc);

create index if not exists transactions_merchant_provider_created_idx
  on public.transactions (merchant_id, provider, created_at desc);

create index if not exists transactions_payment_created_idx
  on public.transactions (payment_id, created_at desc);

create index if not exists payment_events_payment_created_idx
  on public.payment_events (payment_id, created_at asc);
