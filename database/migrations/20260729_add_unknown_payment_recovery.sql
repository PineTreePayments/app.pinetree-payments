-- Forward-only lifecycle expansion for explicit recovery exceptions.
-- UNKNOWN is not a silent failure: the one-minute recovery job continues to
-- recheck these rows, while dashboards can clearly identify investigation work.

begin;

do $migration$
declare
  constraint_row record;
  unsupported_statuses text;
begin
  select string_agg(status_value, ', ' order by status_value)
    into unsupported_statuses
  from (
    select distinct coalesce(quote_literal(status::text), '<NULL>') as status_value
    from public.payments
    where status is null
       or status::text not in (
         'CREATED', 'PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED',
         'EXPIRED', 'CANCELED', 'INCOMPLETE', 'UNKNOWN'
       )
  ) unexpected;

  if unsupported_statuses is not null then
    raise exception 'Cannot install payment recovery lifecycle constraint; unsupported statuses: %', unsupported_statuses;
  end if;

  for constraint_row in
    select constraint_definition.conname
    from pg_constraint constraint_definition
    join pg_attribute status_attribute
      on status_attribute.attrelid = constraint_definition.conrelid
     and status_attribute.attname = 'status'
     and not status_attribute.attisdropped
    where constraint_definition.conrelid = 'public.payments'::regclass
      and constraint_definition.contype = 'c'
      and cardinality(constraint_definition.conkey) = 1
      and constraint_definition.conkey @> array[status_attribute.attnum]::smallint[]
  loop
    execute format('alter table public.payments drop constraint %I', constraint_row.conname);
  end loop;
end
$migration$;

alter table public.payments
  add constraint payments_status_lifecycle_check
  check (status in (
    'CREATED', 'PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED',
    'EXPIRED', 'CANCELED', 'INCOMPLETE', 'UNKNOWN'
  ))
  not valid;

alter table public.payments validate constraint payments_status_lifecycle_check;

comment on constraint payments_status_lifecycle_check on public.payments is
  'Canonical payment lifecycle plus explicit UNKNOWN recovery exceptions; UNKNOWN remains periodically reconciled.';

-- UNKNOWN transitions append an explicit audit event. Expand the event-type
-- constraint in the same transaction so the status row and its audit event
-- cannot disagree because one schema accepts UNKNOWN before the other does.
do $events$
declare
  constraint_row record;
  unsupported_event_types text;
begin
  if to_regclass('public.payment_events') is null then
    raise exception 'public.payment_events does not exist';
  end if;

  select string_agg(event_value, ', ' order by event_value)
    into unsupported_event_types
  from (
    select distinct coalesce(quote_literal(event_type::text), '<NULL>') as event_value
    from public.payment_events
    where event_type is null
       or event_type::text not in (
         'payment.created', 'payment.pending', 'payment.processing',
         'payment.confirmed', 'payment.failed', 'payment.canceled',
         'payment.cancelled', 'payment.incomplete', 'payment.expired',
         'payment.refunded', 'payment.reconciled', 'payment.unknown'
       )
  ) unexpected;

  if unsupported_event_types is not null then
    raise exception 'Cannot install payment recovery event constraint; unsupported event types: %', unsupported_event_types;
  end if;

  for constraint_row in
    select constraint_definition.conname
    from pg_constraint constraint_definition
    join pg_attribute event_attribute
      on event_attribute.attrelid = constraint_definition.conrelid
     and event_attribute.attname = 'event_type'
     and not event_attribute.attisdropped
    where constraint_definition.conrelid = 'public.payment_events'::regclass
      and constraint_definition.contype = 'c'
      and cardinality(constraint_definition.conkey) = 1
      and constraint_definition.conkey @> array[event_attribute.attnum]::smallint[]
      and pg_get_constraintdef(constraint_definition.oid) ilike '%payment.%'
  loop
    execute format('alter table public.payment_events drop constraint %I', constraint_row.conname);
  end loop;
end
$events$;

alter table public.payment_events
  add constraint payment_events_event_type_check
  check (event_type in (
    'payment.created', 'payment.pending', 'payment.processing',
    'payment.confirmed', 'payment.failed', 'payment.canceled',
    'payment.cancelled', 'payment.incomplete', 'payment.expired',
    'payment.refunded', 'payment.reconciled', 'payment.unknown'
  ))
  not valid;

alter table public.payment_events validate constraint payment_events_event_type_check;

-- A committed call to this function is the application deployment gate. The
-- function and UNKNOWN constraints become visible atomically at COMMIT, so an
-- older database can never be mistaken for one that accepts UNKNOWN.
create or replace function public.payment_recovery_schema_ready()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;

-- Cross-instance cron lease. Vercel/serverless warm-instance globals cannot
-- prevent two different instances from running the same provider operations.
create table if not exists public.payment_maintenance_leases (
  lease_name text primary key,
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint payment_maintenance_lease_name_check
    check (lease_name = 'payment-recovery')
);

create or replace function public.claim_payment_maintenance_run(
  p_lease_token uuid,
  p_lease_seconds integer default 90
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  claimed boolean := false;
  bounded_seconds integer := greatest(5, least(coalesce(p_lease_seconds, 90), 300));
begin
  insert into public.payment_maintenance_leases (
    lease_name,
    lease_token,
    lease_expires_at,
    updated_at
  ) values (
    'payment-recovery',
    p_lease_token,
    clock_timestamp() + make_interval(secs => bounded_seconds),
    clock_timestamp()
  )
  on conflict (lease_name) do update
    set lease_token = excluded.lease_token,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = excluded.updated_at
    where public.payment_maintenance_leases.lease_expires_at <= clock_timestamp()
  returning true into claimed;

  return coalesce(claimed, false);
end
$function$;

revoke all on function public.payment_recovery_schema_ready() from public;
revoke all on function public.claim_payment_maintenance_run(uuid, integer) from public;
revoke all on table public.payment_maintenance_leases from public;
grant execute on function public.payment_recovery_schema_ready() to service_role;
grant execute on function public.claim_payment_maintenance_run(uuid, integer) to service_role;

notify pgrst, 'reload schema';

commit;
