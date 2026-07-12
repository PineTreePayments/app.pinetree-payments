-- Server-only administrative credential retention for PineTree-created Speed
-- Custom Connect accounts. Speed requires portal-password auth for some
-- account operations (e.g. full account deletion); this table lets a PineTree
-- administrator retrieve a merchant's Speed account password without ever
-- exposing Speed branding, the account, or the password to the merchant.
-- The password is encrypted at the application layer (AES-256-GCM, see
-- providers/lightning/speedCredentialCrypto.ts) before it reaches this
-- table - the database never sees plaintext.
create table if not exists public.merchant_speed_credentials (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  speed_connected_account_id text not null,
  speed_login_email text not null,
  encrypted_password text not null,
  encryption_iv text not null,
  encryption_auth_tag text not null,
  environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rotated_at timestamptz
);

-- One retained credential per merchant per environment.
create unique index if not exists merchant_speed_credentials_merchant_env_uidx
  on public.merchant_speed_credentials (merchant_id, environment);

create index if not exists merchant_speed_credentials_account_id_idx
  on public.merchant_speed_credentials (speed_connected_account_id);

alter table public.merchant_speed_credentials enable row level security;

-- No merchant, authenticated client, or anonymous access whatsoever. Only the
-- service-role client (supabaseAdmin) may read or write this table, from
-- server-side provisioning code (database/merchantSpeedCredentials.ts) and
-- admin-authorized credential routes (app/api/admin/speed-credentials/*)
-- only. Never expose this table through a merchant-facing API.
revoke all on public.merchant_speed_credentials from anon, authenticated;

comment on table public.merchant_speed_credentials is
  'Encrypted Speed Custom Connect login credentials for PineTree-created merchant accounts. Service-role access only - never merchant or client-facing. Password is AES-256-GCM encrypted at the application layer before storage.';
