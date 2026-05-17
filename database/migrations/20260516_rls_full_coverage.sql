-- PineTree Payments — Full RLS Coverage + Schema Hardening
-- Run after 20260518_support_ticket_messages.sql
--
-- What this migration does:
-- 1. Adds missing columns to merchants and merchant_settings used by the engine
-- 2. Creates tables referenced in code but absent from prior migrations
-- 3. Installs an auto-bootstrap trigger: merchant + settings rows created on auth.users insert
-- 4. Backfills existing auth users who have no merchant row
-- 5. Enables RLS on every tenant-sensitive table not yet protected
--
-- Service-role operations are unaffected: service role bypasses RLS by design.
-- All existing backend/webhook/payment engine paths continue to work.

-- ─── merchants: add columns the engine and admin code reference ───────────────

alter table public.merchants
  add column if not exists business_name text,
  add column if not exists role          text not null default 'merchant',
  add column if not exists status        text not null default 'active';

-- ─── merchant_settings: add columns the settings engine queries directly ──────
-- The settings engine selects named columns from merchant_settings rather than
-- reading from the jsonb blob, so those columns must exist as real columns.

alter table public.merchant_settings
  add column if not exists business_name       text,
  add column if not exists address             text,
  add column if not exists city                text,
  add column if not exists state               text,
  add column if not exists zip                 text,
  add column if not exists country             text,
  add column if not exists phone               text,
  add column if not exists business_type       text,
  add column if not exists closeout_time       text    not null default '12:00',
  add column if not exists report_toast        boolean not null default true,
  add column if not exists default_provider    text,
  add column if not exists pinetree_fee_enabled boolean not null default true,
  add column if not exists pinetree_fee_amount  numeric not null default 0,
  add column if not exists tax_enabled         boolean not null default false,
  add column if not exists tax_rate            numeric not null default 0;

-- ─── checkout_links ──────────────────────────────────────────────────────────
-- Referenced by database/checkoutLinks.ts but absent from prior migrations.

create table if not exists public.checkout_links (
  id            uuid        primary key default gen_random_uuid(),
  merchant_id   uuid        not null,
  public_token  text        not null unique,
  name          text        not null,
  description   text,
  amount        numeric     not null,
  currency      text        not null default 'USD',
  customer_email text,
  reference     text,
  status        text        not null default 'active',
  expires_at    timestamptz,
  success_url   text,
  cancel_url    text,
  link_metadata jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists checkout_links_merchant_id_idx
  on public.checkout_links (merchant_id);
create index if not exists checkout_links_public_token_idx
  on public.checkout_links (public_token);
create index if not exists checkout_links_status_idx
  on public.checkout_links (status);

-- ─── merchant_webhooks ───────────────────────────────────────────────────────
-- Referenced by database/merchantWebhooks.ts but absent from prior migrations.

create table if not exists public.merchant_webhooks (
  id          uuid        primary key default gen_random_uuid(),
  merchant_id uuid        not null,
  url         text        not null,
  secret      text        not null,
  events      jsonb       not null default '[]',
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists merchant_webhooks_merchant_id_idx
  on public.merchant_webhooks (merchant_id);

-- ─── webhook_deliveries ──────────────────────────────────────────────────────
-- Referenced by database/merchantWebhooks.ts insertWebhookDelivery.

create table if not exists public.webhook_deliveries (
  id              uuid        primary key default gen_random_uuid(),
  merchant_id     uuid        not null,
  webhook_id      uuid        not null,
  event           text        not null,
  payload         jsonb       not null default '{}',
  status          text        not null default 'pending',
  response_status int,
  response_body   text,
  attempt_count   int         not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists webhook_deliveries_merchant_id_idx
  on public.webhook_deliveries (merchant_id);
create index if not exists webhook_deliveries_webhook_id_idx
  on public.webhook_deliveries (webhook_id);
create index if not exists webhook_deliveries_created_at_idx
  on public.webhook_deliveries (created_at desc);

-- ─── merchant_api_keys ───────────────────────────────────────────────────────
-- Referenced by database/merchantApiKeys.ts and engine/merchantApiKeys.ts.

create table if not exists public.merchant_api_keys (
  id           uuid        primary key default gen_random_uuid(),
  merchant_id  uuid        not null,
  name         text,
  key_prefix   text        not null,
  key_hash     text        not null,
  permissions  jsonb       not null default '[]',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists merchant_api_keys_merchant_id_idx
  on public.merchant_api_keys (merchant_id);
create index if not exists merchant_api_keys_key_prefix_idx
  on public.merchant_api_keys (key_prefix);

-- ─── Auto-bootstrap trigger ───────────────────────────────────────────────────
-- Fires AFTER INSERT on auth.users.
-- Creates the public.merchants row and a blank merchant_settings row so that
-- a newly signed-up user can land on the dashboard without hitting missing-row
-- errors. security definer means it runs with the function owner's privileges
-- and is not blocked by RLS on merchants or merchant_settings.
-- on conflict do nothing makes it idempotent.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.merchants (id, email, business_name, role, status, created_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'business_name'), ''),
      split_part(new.email, '@', 1)
    ),
    'merchant',
    'active',
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.merchant_settings (merchant_id, settings, created_at, updated_at)
  values (new.id, '{}', now(), now())
  on conflict (merchant_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Backfill: existing auth users without merchant rows ─────────────────────
-- One-time backfill for any users who signed up before this migration.
-- The trigger covers all future sign-ups.

insert into public.merchants (id, email, business_name, role, status, created_at, updated_at)
select
  au.id,
  au.email,
  coalesce(
    nullif(trim(au.raw_user_meta_data->>'business_name'), ''),
    split_part(au.email, '@', 1)
  ),
  'merchant',
  'active',
  now(),
  now()
from auth.users au
where not exists (select 1 from public.merchants m where m.id = au.id)
on conflict (id) do nothing;

-- Backfill merchant_settings for any merchants still missing their row.
insert into public.merchant_settings (merchant_id, settings, created_at, updated_at)
select m.id, '{}', now(), now()
from public.merchants m
where not exists (select 1 from public.merchant_settings ms where ms.merchant_id = m.id)
on conflict (merchant_id) do nothing;

-- ─── RLS: merchants ──────────────────────────────────────────────────────────
-- Merchants can SELECT and UPDATE only their own row.
-- INSERT is handled by the bootstrap trigger (security definer, bypasses RLS).
-- DELETE is not granted: merchant records should persist.

alter table public.merchants enable row level security;

drop policy if exists "Merchants view own profile"   on public.merchants;
drop policy if exists "Merchants update own profile" on public.merchants;

create policy "Merchants view own profile"
  on public.merchants for select
  using (id = auth.uid());

create policy "Merchants update own profile"
  on public.merchants for update
  using (id = auth.uid());

-- ─── RLS: merchant_settings ──────────────────────────────────────────────────
-- All CRUD scoped to merchant's own row.
-- INSERT via trigger on signup; client may also upsert own row via API route.

alter table public.merchant_settings enable row level security;

drop policy if exists "Merchants manage own settings" on public.merchant_settings;
create policy "Merchants manage own settings"
  on public.merchant_settings for all
  using (merchant_id = auth.uid());

-- ─── RLS: merchant_providers ─────────────────────────────────────────────────

alter table public.merchant_providers enable row level security;

drop policy if exists "Merchants manage own providers" on public.merchant_providers;
create policy "Merchants manage own providers"
  on public.merchant_providers for all
  using (merchant_id = auth.uid());

-- ─── RLS: merchant_credentials ───────────────────────────────────────────────
-- Credential values (API keys, secrets) scoped to owner only.

alter table public.merchant_credentials enable row level security;

drop policy if exists "Merchants manage own credentials" on public.merchant_credentials;
create policy "Merchants manage own credentials"
  on public.merchant_credentials for all
  using (merchant_id = auth.uid());

-- ─── RLS: merchant_tax_settings ──────────────────────────────────────────────

alter table public.merchant_tax_settings enable row level security;

drop policy if exists "Merchants manage own tax settings" on public.merchant_tax_settings;
create policy "Merchants manage own tax settings"
  on public.merchant_tax_settings for all
  using (merchant_id = auth.uid());

-- ─── RLS: routing_rules ──────────────────────────────────────────────────────

alter table public.routing_rules enable row level security;

drop policy if exists "Merchants manage own routing rules" on public.routing_rules;
create policy "Merchants manage own routing rules"
  on public.routing_rules for all
  using (merchant_id = auth.uid());

-- ─── RLS: terminals ──────────────────────────────────────────────────────────

alter table public.terminals enable row level security;

drop policy if exists "Merchants manage own terminals" on public.terminals;
create policy "Merchants manage own terminals"
  on public.terminals for all
  using (merchant_id = auth.uid());

-- ─── RLS: checkout_links ─────────────────────────────────────────────────────
-- Merchants manage their own links.
-- Hosted-checkout reads go through /api/checkout/* server routes which use
-- supabaseAdmin and are unaffected by RLS — no separate public SELECT policy needed.

alter table public.checkout_links enable row level security;

drop policy if exists "Merchants manage own checkout links" on public.checkout_links;
create policy "Merchants manage own checkout links"
  on public.checkout_links for all
  using (merchant_id = auth.uid());

-- ─── RLS: merchant_webhooks ──────────────────────────────────────────────────
-- Webhook secrets are sensitive; scoped strictly to the owner.

alter table public.merchant_webhooks enable row level security;

drop policy if exists "Merchants manage own webhooks" on public.merchant_webhooks;
create policy "Merchants manage own webhooks"
  on public.merchant_webhooks for all
  using (merchant_id = auth.uid());

-- ─── RLS: webhook_deliveries ─────────────────────────────────────────────────
-- Merchants can only read their own delivery log.
-- Writes come exclusively from the backend payment engine (service role).

alter table public.webhook_deliveries enable row level security;

drop policy if exists "Merchants view own webhook deliveries" on public.webhook_deliveries;
create policy "Merchants view own webhook deliveries"
  on public.webhook_deliveries for select
  using (merchant_id = auth.uid());

-- ─── RLS: merchant_api_keys ──────────────────────────────────────────────────
-- key_hash is a bcrypt hash of the raw secret — exposing it to the owner is safe.
-- Raw secrets are never stored, only hashes.

alter table public.merchant_api_keys enable row level security;

drop policy if exists "Merchants manage own api keys" on public.merchant_api_keys;
create policy "Merchants manage own api keys"
  on public.merchant_api_keys for all
  using (merchant_id = auth.uid());

-- ─── RLS: support_tickets ────────────────────────────────────────────────────

alter table public.support_tickets enable row level security;

drop policy if exists "Merchants manage own tickets" on public.support_tickets;
create policy "Merchants manage own tickets"
  on public.support_tickets for all
  using (merchant_id = auth.uid());

-- ─── RLS: merchant_feedback ──────────────────────────────────────────────────

alter table public.merchant_feedback enable row level security;

drop policy if exists "Merchants manage own feedback" on public.merchant_feedback;
create policy "Merchants manage own feedback"
  on public.merchant_feedback for all
  using (merchant_id = auth.uid());

-- ─── RLS: support_ticket_messages ────────────────────────────────────────────

alter table public.support_ticket_messages enable row level security;

drop policy if exists "Merchants manage own ticket messages" on public.support_ticket_messages;
create policy "Merchants manage own ticket messages"
  on public.support_ticket_messages for all
  using (merchant_id = auth.uid());

-- ─── RLS: idempotency_keys (service-role only) ───────────────────────────────
-- idempotency_keys is written and read exclusively by the payment engine via
-- supabaseAdmin. No client-side access is ever needed.
-- Enabling RLS with no policies means only service role can access this table.

alter table public.idempotency_keys enable row level security;

-- ─── RLS: solflare_deeplink_sessions (service-role only) ─────────────────────
-- Flow state for Solflare Universal Link callbacks. Internal backend use only.
-- No client access is needed or safe.

alter table public.solflare_deeplink_sessions enable row level security;

-- ─── Notify PostgREST to reload schema cache ─────────────────────────────────

select pg_notify('pgrst', 'reload schema');
