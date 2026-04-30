-- Server-backed Solflare Universal Link flow state.
-- Required because Solflare callbacks may return in a different browser context
-- where the original browser sessionStorage keypair is unavailable.

create table if not exists public.solflare_deeplink_sessions (
  id                              uuid         primary key default gen_random_uuid(),
  flow_id                         text         not null unique,
  payment_id                      uuid         not null references public.payments(id) on delete cascade,
  intent_id                       uuid         references public.payment_intents(id) on delete set null,
  selected_asset                  text         not null,
  dapp_public_key                 text         not null,
  dapp_secret_key                 jsonb        not null,
  solflare_session                text,
  solflare_wallet_public_key      text,
  solflare_encryption_public_key  text,
  created_at                      timestamptz  not null default now(),
  updated_at                      timestamptz  not null default now(),
  consumed_at                     timestamptz
);

create index if not exists solflare_deeplink_sessions_flow_id_idx
  on public.solflare_deeplink_sessions (flow_id);

create index if not exists solflare_deeplink_sessions_payment_id_idx
  on public.solflare_deeplink_sessions (payment_id);

create index if not exists solflare_deeplink_sessions_created_at_idx
  on public.solflare_deeplink_sessions (created_at desc);