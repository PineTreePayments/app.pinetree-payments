-- Strict first-deployment onboarding evidence. This migration never adopts or
-- replaces pre-existing objects.
begin;

do $preflight$
declare
  v_name text;
begin
  foreach v_name in array array[
    'shift4_onboarding_sessions',
    'shift4_onboarding_events',
    'shift4_onboarding_sessions_merchant_created_idx',
    'shift4_onboarding_sessions_status_idx',
    'shift4_onboarding_events_session_received_idx',
    'shift4_onboarding_events_merchant_received_idx'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception 'Shift4 onboarding object public.% already exists. Inspect schema drift.', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'shift4_onboarding_guard_ownership',
    'shift4_onboarding_touch_updated_at',
    'shift4_onboarding_events_immutable',
    'create_shift4_onboarding_session',
    'apply_shift4_onboarding_update'
  ] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname=v_name
    ) then
      raise exception 'Shift4 onboarding function public.% already exists. Inspect schema drift.', v_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_constraint
     where conname in (
       'shift4_onboarding_sessions_status_check',
       'shift4_onboarding_sessions_application_unique',
       'shift4_onboarding_sessions_launch_unique',
       'shift4_onboarding_sessions_reason_safe',
       'shift4_onboarding_sessions_hosted_url_safe',
       'shift4_onboarding_sessions_correlation_present',
       'shift4_onboarding_events_identity_unique',
       'shift4_onboarding_events_status_check',
       'shift4_onboarding_events_source_check',
       'shift4_onboarding_events_reason_safe'
     )
  ) then
    raise exception 'One or more Shift4 onboarding constraint names already exist. Inspect schema drift.';
  end if;

  if to_regclass('public.merchants') is null
     or to_regclass('public.merchant_providers') is null then
    raise exception 'Shift4 onboarding requires public.merchants and public.merchant_providers';
  end if;

  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'Shift4 onboarding requires gen_random_uuid()';
  end if;

  foreach v_name in array array['service_role','anon','authenticated'] loop
    if not exists (select 1 from pg_roles where rolname=v_name) then
      raise exception 'Shift4 onboarding requires database role %', v_name;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='merchants'
       and column_name='id' and data_type='uuid'
  ) then
    raise exception 'Shift4 onboarding requires merchants.id to be uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='merchant_providers'
       and column_name in ('id','merchant_id') and data_type='uuid'
     group by table_name having count(distinct column_name)=2
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='merchant_providers'
       and column_name='provider'
       and data_type in ('text','character varying','character')
  ) then
    raise exception 'Shift4 onboarding requires merchant_providers.id/merchant_id uuid and provider text-compatible';
  end if;

  if exists (
    select 1 from public.merchant_providers mp
     where lower(btrim(mp.provider))='shift4_rest'
       and mp.provider <> 'shift4_rest'
  ) then
    raise exception 'Noncanonical Shift4 REST provider key detected; expected exact shift4_rest';
  end if;
end
$preflight$;

create table public.shift4_onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  merchant_provider_connection_id uuid not null references public.merchant_providers (id) on delete restrict,
  provider_application_id text not null,
  launch_reference text not null,
  hosted_application_url text,
  status text not null,
  status_reason_code text,
  correlation_id text not null,
  submitted_at timestamptz,
  received_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift4_onboarding_sessions_status_check check (status in (
    'not_started', 'draft', 'application_started', 'submitted', 'received',
    'under_review', 'more_information_required', 'approved', 'declined',
    'canceled', 'blocked', 'error'
  )),
  constraint shift4_onboarding_sessions_application_unique unique (merchant_provider_connection_id, provider_application_id),
  constraint shift4_onboarding_sessions_launch_unique unique (merchant_provider_connection_id, launch_reference),
  constraint shift4_onboarding_sessions_reason_safe check (status_reason_code is null or status_reason_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  constraint shift4_onboarding_sessions_hosted_url_safe check (hosted_application_url is null or hosted_application_url ~ '^https://'),
  constraint shift4_onboarding_sessions_correlation_present check (length(btrim(correlation_id)) between 1 and 200)
);

create index shift4_onboarding_sessions_merchant_created_idx
  on public.shift4_onboarding_sessions (merchant_id, created_at desc);
create index shift4_onboarding_sessions_status_idx
  on public.shift4_onboarding_sessions (status, updated_at);

create table public.shift4_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  onboarding_session_id uuid not null references public.shift4_onboarding_sessions (id) on delete restrict,
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  provider_application_id text not null,
  update_reference text not null,
  provider_status text not null,
  status_reason_code text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  correlation_id text not null,
  verified boolean not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint shift4_onboarding_events_identity_unique unique (onboarding_session_id, update_reference),
  constraint shift4_onboarding_events_status_check check (provider_status in (
    'not_started', 'draft', 'application_started', 'submitted', 'received',
    'under_review', 'more_information_required', 'approved', 'declined',
    'canceled', 'blocked', 'error'
  )),
  constraint shift4_onboarding_events_source_check check (source in ('fixture', 'structured_email', 'provider_api')),
  constraint shift4_onboarding_events_reason_safe check (status_reason_code is null or status_reason_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$')
);

create index shift4_onboarding_events_session_received_idx
  on public.shift4_onboarding_events (
    onboarding_session_id, occurred_at desc, received_at desc, id desc
  );
create index shift4_onboarding_events_merchant_received_idx
  on public.shift4_onboarding_events (merchant_id, received_at desc);

alter table public.shift4_onboarding_sessions enable row level security;
alter table public.shift4_onboarding_sessions force row level security;
alter table public.shift4_onboarding_events enable row level security;
alter table public.shift4_onboarding_events force row level security;

revoke all on public.shift4_onboarding_sessions from public;
revoke all on public.shift4_onboarding_sessions from anon;
revoke all on public.shift4_onboarding_sessions from authenticated;
revoke all on public.shift4_onboarding_sessions from service_role;
revoke all on public.shift4_onboarding_events from public;
revoke all on public.shift4_onboarding_events from anon;
revoke all on public.shift4_onboarding_events from authenticated;
revoke all on public.shift4_onboarding_events from service_role;
grant select on public.shift4_onboarding_sessions to service_role;
grant select on public.shift4_onboarding_events to service_role;

create function public.shift4_onboarding_guard_ownership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_connection_merchant_id uuid;
  v_provider text;
begin
  select mp.merchant_id, mp.provider
    into strict v_connection_merchant_id, v_provider
    from public.merchant_providers mp
    where mp.id = new.merchant_provider_connection_id;
  if v_connection_merchant_id is distinct from new.merchant_id
     or v_provider is distinct from 'shift4_rest' then
    raise exception 'Shift4 onboarding connection ownership mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger shift4_onboarding_sessions_ownership_trigger
before insert or update of merchant_id, merchant_provider_connection_id
on public.shift4_onboarding_sessions
for each row execute function public.shift4_onboarding_guard_ownership();

create function public.shift4_onboarding_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger shift4_onboarding_sessions_updated_at_trigger
before update on public.shift4_onboarding_sessions
for each row execute function public.shift4_onboarding_touch_updated_at();

create function public.shift4_onboarding_events_immutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Shift4 onboarding events are append-only' using errcode = '55000';
end;
$$;

create trigger shift4_onboarding_events_immutable_trigger
before update or delete on public.shift4_onboarding_events
for each row execute function public.shift4_onboarding_events_immutable();

create function public.create_shift4_onboarding_session(
  p_merchant_id uuid,
  p_merchant_provider_connection_id uuid,
  p_provider_application_id text,
  p_launch_reference text,
  p_hosted_application_url text,
  p_status text,
  p_correlation_id text
)
returns setof public.shift4_onboarding_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_status <> 'application_started' then
    raise exception 'Initial Shift4 onboarding status must be application_started';
  end if;
  return query
    insert into public.shift4_onboarding_sessions (
      merchant_id, merchant_provider_connection_id, provider_application_id,
      launch_reference, hosted_application_url, status, correlation_id
    ) values (
      p_merchant_id, p_merchant_provider_connection_id, p_provider_application_id,
      p_launch_reference, p_hosted_application_url, p_status, p_correlation_id
    ) returning *;
end;
$$;

create function public.apply_shift4_onboarding_update(
  p_merchant_id uuid,
  p_merchant_provider_connection_id uuid,
  p_provider_application_id text,
  p_update_reference text,
  p_status text,
  p_status_reason_code text,
  p_occurred_at timestamptz,
  p_correlation_id text,
  p_verified boolean,
  p_source text
)
returns setof public.shift4_onboarding_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.shift4_onboarding_sessions%rowtype;
  v_existing_event public.shift4_onboarding_events%rowtype;
  v_inserted_id uuid;
  v_connection_merchant_id uuid;
  v_connection_provider text;
begin
  if not p_verified then
    raise exception 'Unverified onboarding updates require manual review' using errcode = '42501';
  end if;

  select mp.merchant_id, mp.provider
    into v_connection_merchant_id, v_connection_provider
    from public.merchant_providers mp
   where mp.id = p_merchant_provider_connection_id;

  if not found
     or v_connection_merchant_id is distinct from p_merchant_id
     or v_connection_provider is distinct from 'shift4_rest' then
    raise exception 'Shift4 onboarding connection identity mismatch' using errcode = '42501';
  end if;

  select * into v_session
    from public.shift4_onboarding_sessions
    where merchant_id = p_merchant_id
      and merchant_provider_connection_id = p_merchant_provider_connection_id
      and provider_application_id = p_provider_application_id
    for update;

  if not found then
    raise exception 'Shift4 onboarding application does not belong to this provider connection' using errcode = '42501';
  end if;

  insert into public.shift4_onboarding_events (
    onboarding_session_id, merchant_id, provider_application_id, update_reference,
    provider_status, status_reason_code, occurred_at, correlation_id, verified, source
  ) values (
    v_session.id, p_merchant_id, p_provider_application_id, p_update_reference,
    p_status, p_status_reason_code, p_occurred_at, p_correlation_id, p_verified, p_source
  ) on conflict (onboarding_session_id, update_reference) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    select * into strict v_existing_event
      from public.shift4_onboarding_events e
     where e.onboarding_session_id = v_session.id
       and e.update_reference = p_update_reference;

    if v_existing_event.onboarding_session_id is distinct from v_session.id
       or v_existing_event.provider_application_id is distinct from p_provider_application_id
       or v_existing_event.provider_status is distinct from p_status
       or v_existing_event.status_reason_code is distinct from p_status_reason_code
       or v_existing_event.occurred_at is distinct from p_occurred_at
       or v_existing_event.correlation_id is distinct from p_correlation_id
       or v_existing_event.verified is distinct from p_verified
       or v_existing_event.source is distinct from p_source then
      raise exception 'Shift4 onboarding update idempotency conflict' using errcode = '23505';
    end if;

    return query select * from public.shift4_onboarding_sessions where id = v_session.id;
    return;
  end if;

  -- Every verified unique event remains append-only evidence, but only the
  -- deterministically newest event owns the mutable session snapshot. The
  -- session row lock above serializes competing inserts for this application.
  update public.shift4_onboarding_sessions
    set status = p_status,
        status_reason_code = p_status_reason_code,
        correlation_id = p_correlation_id,
        submitted_at = case when p_status = 'submitted' then coalesce(submitted_at, p_occurred_at) else submitted_at end,
        received_at = case when p_status in ('received', 'under_review') then coalesce(received_at, p_occurred_at) else received_at end,
        reviewed_at = case when p_status in ('approved', 'declined') then coalesce(reviewed_at, p_occurred_at) else reviewed_at end
    where id = v_session.id
      and v_inserted_id = (
        select e.id
          from public.shift4_onboarding_events e
         where e.onboarding_session_id = v_session.id
         order by e.occurred_at desc, e.received_at desc, e.id desc
         limit 1
      );

  return query select * from public.shift4_onboarding_sessions where id = v_session.id;
end;
$$;

revoke all on function public.shift4_onboarding_guard_ownership() from public, anon, authenticated, service_role;
revoke all on function public.shift4_onboarding_touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.shift4_onboarding_events_immutable() from public, anon, authenticated, service_role;
revoke all on function public.create_shift4_onboarding_session(uuid, uuid, text, text, text, text, text) from public;
revoke all on function public.create_shift4_onboarding_session(uuid, uuid, text, text, text, text, text) from anon;
revoke all on function public.create_shift4_onboarding_session(uuid, uuid, text, text, text, text, text) from authenticated;
revoke all on function public.create_shift4_onboarding_session(uuid, uuid, text, text, text, text, text) from service_role;
grant execute on function public.create_shift4_onboarding_session(uuid, uuid, text, text, text, text, text) to service_role;
revoke all on function public.apply_shift4_onboarding_update(uuid, uuid, text, text, text, text, timestamptz, text, boolean, text) from public;
revoke all on function public.apply_shift4_onboarding_update(uuid, uuid, text, text, text, text, timestamptz, text, boolean, text) from anon;
revoke all on function public.apply_shift4_onboarding_update(uuid, uuid, text, text, text, text, timestamptz, text, boolean, text) from authenticated;
revoke all on function public.apply_shift4_onboarding_update(uuid, uuid, text, text, text, text, timestamptz, text, boolean, text) from service_role;
grant execute on function public.apply_shift4_onboarding_update(uuid, uuid, text, text, text, text, timestamptz, text, boolean, text) to service_role;

notify pgrst, 'reload schema';

commit;
