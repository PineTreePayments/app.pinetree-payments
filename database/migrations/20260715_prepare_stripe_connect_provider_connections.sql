-- Stripe Connect embedded onboarding: provider-connection hardening.
--
-- PineTree reuses the existing generalized merchant_providers model for the
-- Stripe connection (provider = 'stripe'). Normalized Stripe state lives in
-- the credentials JSONB column written only by PineTree Engine
-- (engine/stripeConnect.ts):
--   stripe_account_id, connection_status, details_submitted,
--   charges_enabled, payouts_enabled, requirements_currently_due,
--   requirements_eventually_due, requirements_past_due,
--   requirements_pending_verification, disabled_reason, capabilities,
--   provider_model, connect_onboarding_started_at, connect_last_synced_at
-- No Stripe secret keys and no Account Session client secrets are ever
-- stored. This migration is idempotent and prepares:
--   1. created_at / updated_at columns (required by Engine upserts)
--   2. the unique merchant/provider relationship (required by
--      upsert ... on conflict (merchant_id, provider))
--   3. row level security: service-role-only access, matching the
--      merchant_speed_credentials precedent for credential-bearing tables.
--      Merchants access their own connection exclusively through
--      authenticated PineTree API routes (/api/providers/stripe/*), which
--      resolve merchant identity from the session and use the server-side
--      service-role client.

-- 1. Timestamps used by Engine upserts.
alter table public.merchant_providers
  add column if not exists created_at timestamptz not null default now();

alter table public.merchant_providers
  add column if not exists updated_at timestamptz not null default now();

-- 2. One connection per merchant per provider (backs the Engine's
--    upsert onConflict: "merchant_id,provider").
create unique index if not exists merchant_providers_merchant_provider_uidx
  on public.merchant_providers (merchant_id, provider);

-- 3. Row level security: credentials JSONB may hold provider connection
--    material (Stripe connected-account state, NWC URIs, Speed account
--    references), so no direct anon/authenticated access is allowed at all.
--    The service-role client (supabaseAdmin) bypasses RLS for PineTree
--    Engine and API routes, which enforce per-merchant authorization.
alter table public.merchant_providers enable row level security;

revoke all on public.merchant_providers from anon, authenticated;

comment on table public.merchant_providers is
  'Generalized merchant/provider connections (one row per merchant per provider). Stripe Connect state is normalized into credentials JSONB by PineTree Engine; no provider secret keys or onboarding client secrets are stored. Service-role access only — merchants reach their own connection through authenticated PineTree API routes.';
