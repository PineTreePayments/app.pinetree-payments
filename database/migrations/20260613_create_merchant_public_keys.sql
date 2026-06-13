create table if not exists public.merchant_public_keys (
  id uuid primary key,
  merchant_id uuid not null,
  name text,
  key_prefix text not null,
  key_hash text not null,
  allowed_origins text[] not null default '{}',
  enabled boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists merchant_public_keys_key_prefix_uidx
  on public.merchant_public_keys (key_prefix);

create index if not exists merchant_public_keys_merchant_id_idx
  on public.merchant_public_keys (merchant_id);

alter table public.merchant_public_keys enable row level security;

-- Public API access is server-side through the service-role client only.
revoke all on public.merchant_public_keys from anon, authenticated;

comment on table public.merchant_public_keys is
  'Browser-safe public API keys (pk_live_*). Safe to embed in client-side code; cannot access server-only endpoints.';
