create table if not exists public.api_idempotency_claims (
  id uuid primary key,
  merchant_id uuid not null,
  route text not null,
  idempotency_key_hash text not null,
  request_hash text not null,
  resource_id text,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create unique index if not exists api_idempotency_claims_merchant_route_key_uidx
  on public.api_idempotency_claims (merchant_id, route, idempotency_key_hash);

create index if not exists api_idempotency_claims_expires_at_idx
  on public.api_idempotency_claims (expires_at);

alter table public.api_idempotency_claims enable row level security;

-- Public API access is server-side through the service-role client only.
revoke all on public.api_idempotency_claims from anon, authenticated;

comment on table public.api_idempotency_claims is
  'Durable public API idempotency claims. Rollback drops replay history and can allow duplicate retries.';
