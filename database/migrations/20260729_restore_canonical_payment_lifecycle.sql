-- Forward-only correction after 20260729_add_unknown_payment_recovery.sql.
-- Payment recovery retains diagnostics in metadata; it does not introduce a
-- ninth payment lifecycle status or rewrite production history.

begin;

do $payments$
declare
  constraint_row record;
  unknown_payment_count bigint;
  unsupported_statuses text;
begin
  select count(*)
    into unknown_payment_count
    from public.payments
   where status::text = 'UNKNOWN';

  if unknown_payment_count > 0 then
    raise exception
      'Cannot restore canonical payment lifecycle: % payment row(s) have status UNKNOWN; investigate explicitly before retrying',
      unknown_payment_count;
  end if;

  select string_agg(status_value, ', ' order by status_value)
    into unsupported_statuses
    from (
      select distinct coalesce(quote_literal(status::text), '<NULL>') as status_value
        from public.payments
       where status is null
          or status::text not in (
            'CREATED', 'PENDING', 'PROCESSING', 'CONFIRMED',
            'FAILED', 'EXPIRED', 'CANCELED', 'INCOMPLETE'
          )
    ) unexpected;

  if unsupported_statuses is not null then
    raise exception
      'Cannot restore canonical payment lifecycle; unsupported statuses: %',
      unsupported_statuses;
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
    execute format(
      'alter table public.payments drop constraint %I',
      constraint_row.conname
    );
  end loop;
end
$payments$;

alter table public.payments
  add constraint payments_status_lifecycle_check
  check (status in (
    'CREATED', 'PENDING', 'PROCESSING', 'CONFIRMED',
    'FAILED', 'EXPIRED', 'CANCELED', 'INCOMPLETE'
  ))
  not valid;

alter table public.payments
  validate constraint payments_status_lifecycle_check;

comment on constraint payments_status_lifecycle_check on public.payments is
  'Canonical PineTree payment lifecycle: CREATED, PENDING, PROCESSING, CONFIRMED, FAILED, EXPIRED, CANCELED, INCOMPLETE.';

do $events$
declare
  constraint_row record;
  unknown_event_count bigint;
  unsupported_event_types text;
begin
  if to_regclass('public.payment_events') is null then
    raise exception 'public.payment_events does not exist';
  end if;

  select count(*)
    into unknown_event_count
    from public.payment_events
   where event_type::text = 'payment.unknown';

  if unknown_event_count > 0 then
    raise exception
      'Cannot restore canonical payment event lifecycle: % payment.unknown event(s) exist; investigate explicitly before retrying',
      unknown_event_count;
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
            'payment.refunded', 'payment.reconciled'
          )
    ) unexpected;

  if unsupported_event_types is not null then
    raise exception
      'Cannot restore canonical payment event lifecycle; unsupported event types: %',
      unsupported_event_types;
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
    execute format(
      'alter table public.payment_events drop constraint %I',
      constraint_row.conname
    );
  end loop;
end
$events$;

alter table public.payment_events
  add constraint payment_events_event_type_check
  check (event_type in (
    'payment.created', 'payment.pending', 'payment.processing',
    'payment.confirmed', 'payment.failed', 'payment.canceled',
    'payment.cancelled', 'payment.incomplete', 'payment.expired',
    'payment.refunded', 'payment.reconciled'
  ))
  not valid;

alter table public.payment_events
  validate constraint payment_events_event_type_check;

-- Keep payment_recovery_schema_ready(), payment_maintenance_leases,
-- claim_payment_maintenance_run(), grants, indexes, and all other recovery
-- infrastructure installed by the preceding migration unchanged.
notify pgrst, 'reload schema';

commit;
