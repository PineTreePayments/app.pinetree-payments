-- Bridge (by Stripe) provider connections + webhook inbox.
--
-- Bridge is owned by Stripe but is a SEPARATE provider connection from Stripe
-- Connect: separate credentials, separate customer identifiers, separate
-- capabilities, separate KYB state, separate webhooks. Bridge rows must never
-- be merged into, or inferred from, the provider = 'stripe' row.
--
-- DESIGN: this migration extends the canonical generalized provider model
-- (public.merchant_providers, provider = 'bridge') rather than introducing an
-- overlapping per-provider connection table. Normalized Bridge state lives in
-- the credentials JSONB column, written only by PineTree Engine
-- (engine/bridgeConnect.ts):
--   bridge_customer_id, bridge_kyc_link_id, bridge_kyc_status,
--   bridge_tos_status, bridge_customer_status, bridge_endorsements,
--   bridge_requirements_due, bridge_future_requirements_due,
--   bridge_action_required, connection_status, onboarding_requested_at,
--   enablement_decision_at, last_synced_at, provider_created_at,
--   provider_updated_at, provider_model
--
-- NEVER stored: the Bridge API key, the webhook public key, hosted kyc_link /
-- tos_link URLs, SSNs, EIN documents, identification images, beneficial-owner
-- documents, or any raw Bridge request payload. Only Bridge identifiers and
-- normalized statuses are persisted.
--
-- Forward-only. Every existing provider row is preserved: nothing here
-- updates, deletes, or rewrites merchant_providers data.

begin;

-- ── Preflight ────────────────────────────────────────────────────────────────
do $preflight$
begin
  if to_regclass('public.merchants') is null
     or to_regclass('public.merchant_providers') is null then
    raise exception 'Bridge provider connections require public.merchants and public.merchant_providers';
  end if;

  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'Bridge provider connections require gen_random_uuid()';
  end if;

  if not exists (
    select 1 from pg_roles where rolname = 'service_role'
  ) then
    raise exception 'Bridge provider connections require the service_role database role';
  end if;

  -- A non-canonical provider key would silently split a merchant's Bridge
  -- state across two rows.
  if exists (
    select 1 from public.merchant_providers mp
     where lower(btrim(mp.provider)) = 'bridge'
       and mp.provider <> 'bridge'
  ) then
    raise exception 'Noncanonical Bridge provider key detected; expected exact bridge';
  end if;
end
$preflight$;

-- ── 1. Provider connection uniqueness ────────────────────────────────────────
-- One connection per merchant per provider. Already created by the Stripe
-- Connect migration; repeated here so this migration is self-sufficient on a
-- database where that one has not run.
create unique index if not exists merchant_providers_merchant_provider_uidx
  on public.merchant_providers (merchant_id, provider);

-- A Bridge customer represents one verified business and must never be shared
-- by two PineTree merchants. Partial so it constrains Bridge rows only and
-- leaves every other provider's credentials JSONB untouched.
create unique index if not exists merchant_providers_bridge_customer_uidx
  on public.merchant_providers ((credentials ->> 'bridge_customer_id'))
  where provider = 'bridge'
    and credentials ->> 'bridge_customer_id' is not null;

-- The KYC link is likewise one-to-one with an onboarding session.
create unique index if not exists merchant_providers_bridge_kyc_link_uidx
  on public.merchant_providers ((credentials ->> 'bridge_kyc_link_id'))
  where provider = 'bridge'
    and credentials ->> 'bridge_kyc_link_id' is not null;

-- Webhook delivery resolves the owning merchant by Bridge identifier.
create index if not exists merchant_providers_bridge_lookup_idx
  on public.merchant_providers (provider, updated_at desc)
  where provider = 'bridge';

-- ── 2. Immutable Bridge webhook inbox ────────────────────────────────────────
-- Deduplication key, out-of-order retention, and diagnostic provenance for
-- every verified Bridge delivery. Raw payloads are an internal record and are
-- never merchant-facing.
create table if not exists public.bridge_webhook_events (
  id                    uuid        primary key default gen_random_uuid(),
  provider_event_id     text        not null,
  event_category        text        not null,
  event_type            text        not null,
  bridge_customer_id    text,
  bridge_kyc_link_id    text,
  merchant_id           uuid        references public.merchants (id) on delete set null,
  -- Bridge's own event timestamp. Ordering key: an older event may be stored
  -- but must never regress a newer applied status.
  occurred_at           timestamptz,
  received_at           timestamptz not null default now(),
  processed_at          timestamptz,
  -- Why a verified event did not change state (duplicate, out_of_order,
  -- unresolved_merchant, unsupported_category). Null once applied.
  skipped_reason        text,
  signature_verified    boolean     not null default true,
  raw_payload           jsonb,
  created_at            timestamptz not null default now(),
  constraint bridge_webhook_events_category_check
    check (event_category in ('customer', 'kyc_link')),
  constraint bridge_webhook_events_skipped_reason_check
    check (
      skipped_reason is null
      or skipped_reason in ('duplicate', 'out_of_order', 'unresolved_merchant', 'unsupported_category')
    ),
  -- Only verified deliveries may be recorded at all.
  constraint bridge_webhook_events_verified_check check (signature_verified)
);

-- Bridge event ids are unique per developer account, and PineTree uses exactly
-- one Bridge developer account per deployment environment. This is the
-- deduplication guard: a redelivered event can never apply twice.
create unique index if not exists bridge_webhook_events_provider_event_id_uidx
  on public.bridge_webhook_events (provider_event_id);

create index if not exists bridge_webhook_events_merchant_received_idx
  on public.bridge_webhook_events (merchant_id, received_at desc);

create index if not exists bridge_webhook_events_customer_idx
  on public.bridge_webhook_events (bridge_customer_id, occurred_at desc)
  where bridge_customer_id is not null;

create index if not exists bridge_webhook_events_unprocessed_idx
  on public.bridge_webhook_events (received_at)
  where processed_at is null;

-- ── 3. Row level security ────────────────────────────────────────────────────
-- Service-role only, matching merchant_providers and speed_webhook_events.
-- Merchants reach their own Bridge connection exclusively through the
-- authenticated PineTree API routes (/api/providers/bridge/*), which resolve
-- merchant identity from the session and filter by merchant server-side.
alter table public.bridge_webhook_events enable row level security;

revoke all on public.bridge_webhook_events from public;
revoke all on public.bridge_webhook_events from anon;
revoke all on public.bridge_webhook_events from authenticated;
grant select, insert, update on public.bridge_webhook_events to service_role;

-- merchant_providers RLS is already enabled by the Stripe Connect migration;
-- reasserted so this migration does not depend on that ordering.
alter table public.merchant_providers enable row level security;
revoke all on public.merchant_providers from anon, authenticated;

comment on table public.bridge_webhook_events is
  'Immutable inbox of verified Bridge (by Stripe) webhook deliveries. Deduplicated on provider_event_id; occurred_at orders status application so a late delivery cannot regress newer state. Service-role access only - never merchant-facing.';

comment on index public.merchant_providers_bridge_customer_uidx is
  'One Bridge customer belongs to exactly one PineTree merchant. Bridge state lives in merchant_providers.credentials for provider = bridge and is never merged with the separate provider = stripe connection.';

notify pgrst, 'reload schema';

commit;
