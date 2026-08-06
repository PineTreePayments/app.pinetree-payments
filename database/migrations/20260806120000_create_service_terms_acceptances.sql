-- PineTree service-provider terms acceptance (append-only consent evidence).
--
-- PineTree onboarding is the single merchant-facing verification flow. Before
-- PineTree may create a customer with a regulated infrastructure partner
-- (currently Bridge, for wallet / stablecoin conversion / settlement), the
-- merchant must knowingly accept PineTree's terms AND the required
-- service-provider disclosure. This table is that evidence.
--
-- DESIGN: append-only. Each acceptance is an immutable record; the newest row
-- for a merchant is the current consent. Nothing here is ever updated or
-- deleted, so a later terms revision adds a row rather than rewriting history.
--
-- NEVER stored here: identity documents, SSNs, EINs, beneficial-owner
-- documents, bank credentials, provider API keys, or any provider payload.
-- Only the fact of acceptance, its version, and who accepted it.
--
-- Forward-only. This migration creates new objects only; it does not read,
-- update, or delete any existing merchant, provider, payment, or ledger row.

begin;

do $preflight$
begin
  if to_regclass('public.merchants') is null then
    raise exception 'Service terms acceptances require public.merchants';
  end if;

  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'Service terms acceptances require gen_random_uuid()';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Service terms acceptances require the service_role database role';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'merchants'
       and column_name = 'id' and data_type = 'uuid'
  ) then
    raise exception 'Service terms acceptances require merchants.id to be uuid';
  end if;
end
$preflight$;

create table if not exists public.merchant_service_terms_acceptances (
  id                    uuid        primary key default gen_random_uuid(),
  merchant_id           uuid        not null references public.merchants (id) on delete restrict,
  -- The PineTree terms bundle version the merchant accepted. Bumping the
  -- version in application code requires a fresh acceptance.
  terms_version         text        not null,
  -- Which infrastructure partners were disclosed at acceptance time, e.g.
  -- ["bridge"]. Recorded so a later partner addition is provably not covered
  -- by an older acceptance.
  disclosed_providers   text[]      not null default '{}',
  -- The authenticated user who accepted, resolved server-side from the
  -- session. Never a client-supplied identifier.
  actor_user_id         uuid,
  accepted_at           timestamptz not null default now(),
  -- Request metadata retained as audit evidence of a deliberate action.
  -- Truncated by the application; never used for tracking or profiling.
  source_ip             inet,
  user_agent            text,
  created_at            timestamptz not null default now(),
  constraint merchant_service_terms_version_present
    check (length(btrim(terms_version)) between 1 and 64),
  constraint merchant_service_terms_user_agent_bounded
    check (user_agent is null or length(user_agent) <= 400)
);

-- The newest acceptance per merchant is the current consent.
create index if not exists merchant_service_terms_merchant_accepted_idx
  on public.merchant_service_terms_acceptances (merchant_id, accepted_at desc);

-- One acceptance row per merchant per terms version: re-submitting the same
-- consent is idempotent instead of inflating the audit trail.
create unique index if not exists merchant_service_terms_merchant_version_uidx
  on public.merchant_service_terms_acceptances (merchant_id, terms_version);

-- ── Append-only enforcement ──────────────────────────────────────────────────
-- Consent evidence must never be rewritten or erased, including by a future
-- service-role caller.
create or replace function public.merchant_service_terms_immutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Merchant service terms acceptances are append-only' using errcode = '55000';
end;
$$;

drop trigger if exists merchant_service_terms_immutable_trigger
  on public.merchant_service_terms_acceptances;

create trigger merchant_service_terms_immutable_trigger
before update or delete on public.merchant_service_terms_acceptances
for each row execute function public.merchant_service_terms_immutable();

-- ── Row level security ───────────────────────────────────────────────────────
-- Service-role only, matching merchant_providers and the other
-- credential/evidence tables. Merchants read their own consent state through
-- authenticated PineTree API routes, which resolve merchant identity from the
-- session and filter by merchant server-side.
alter table public.merchant_service_terms_acceptances enable row level security;

revoke all on public.merchant_service_terms_acceptances from public;
revoke all on public.merchant_service_terms_acceptances from anon;
revoke all on public.merchant_service_terms_acceptances from authenticated;
grant select, insert on public.merchant_service_terms_acceptances to service_role;

revoke all on function public.merchant_service_terms_immutable() from public, anon, authenticated, service_role;

comment on table public.merchant_service_terms_acceptances is
  'Append-only evidence that a merchant accepted PineTree terms and the required service-provider disclosure before PineTree created any infrastructure-partner customer. Newest row per merchant is current consent. Service-role access only; no identity documents or provider payloads are stored.';

notify pgrst, 'reload schema';

commit;
