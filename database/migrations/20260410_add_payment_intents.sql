create table if not exists public.payment_intents (
  id text primary key,
  merchant_id text not null,
  amount numeric not null,
  currency text not null,
  terminal_id text null,
  pinetree_fee numeric not null default 0,
  metadata jsonb null,
  available_networks jsonb not null default '[]'::jsonb,
  selected_network text null,
  payment_id text null,
  status text not null default 'CREATED',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_intents_merchant_idx on public.payment_intents (merchant_id);
create index if not exists payment_intents_status_idx on public.payment_intents (status);
create index if not exists payment_intents_expires_idx on public.payment_intents (expires_at);
