-- Forward-only payment lifecycle constraint expansion.
--
-- The payments row is PineTree's operational lifecycle source of truth. Keep
-- EXPIRED, CANCELED, and INCOMPLETE distinct at rest; refunds/disputes remain
-- accounting adjustments outside this column.
--
-- Safety properties:
--   * aborts before DDL when an unknown historical value exists;
--   * only normalizes the legacy CANCELLED spelling;
--   * removes only CHECK constraints whose sole referenced column is status;
--   * preserves payment/event/transaction history and lifecycle timestamps;
--   * adds the replacement constraint NOT VALID before validating existing rows.

begin;

do $migration$
declare
  status_type text;
  unsupported_statuses text;
  constraint_row record;
begin
  if to_regclass('public.payments') is null then
    raise exception 'public.payments does not exist';
  end if;

  select format_type(attribute.atttypid, attribute.atttypmod)
    into status_type
  from pg_attribute attribute
  where attribute.attrelid = 'public.payments'::regclass
    and attribute.attname = 'status'
    and not attribute.attisdropped;

  if status_type is null then
    raise exception 'public.payments.status does not exist';
  end if;

  -- The deployed payments schema uses a text status plus a CHECK constraint.
  -- Fail closed instead of silently converting a domain/enum if an environment
  -- has drifted from that shape.
  if status_type <> 'text' and status_type not like 'character varying%' then
    raise exception 'public.payments.status has unsupported type %; expected text or character varying', status_type;
  end if;

  select string_agg(status_value, ', ' order by status_value)
    into unsupported_statuses
  from (
    select distinct coalesce(quote_literal(status::text), '<NULL>') as status_value
    from public.payments
    where status is null
       or (
         upper(btrim(status::text)) <> 'CANCELLED'
         and status::text not in (
           'CREATED',
           'PENDING',
           'PROCESSING',
           'CONFIRMED',
           'FAILED',
           'EXPIRED',
           'CANCELED',
           'INCOMPLETE'
         )
       )
  ) unexpected;

  if unsupported_statuses is not null then
    raise exception 'Cannot install payments lifecycle constraint; unsupported statuses: %', unsupported_statuses
      using hint = 'Reconcile unsupported rows through the Engine before rerunning this migration.';
  end if;

  -- Existing environments may have different generated names for the original
  -- inline CHECK. Remove only status-only checks; composite business invariants
  -- are deliberately left untouched.
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
$migration$;

-- Normalize spelling only. Do not touch updated_at: this is a vocabulary
-- repair, not a new lifecycle transition.
update public.payments
set status = 'CANCELED'
where upper(btrim(status::text)) = 'CANCELLED';

alter table public.payments
  add constraint payments_status_lifecycle_check
  check (status in (
    'CREATED',
    'PENDING',
    'PROCESSING',
    'CONFIRMED',
    'FAILED',
    'EXPIRED',
    'CANCELED',
    'INCOMPLETE'
  ))
  not valid;

alter table public.payments
  validate constraint payments_status_lifecycle_check;

comment on constraint payments_status_lifecycle_check on public.payments is
  'Canonical payment lifecycle values. EXPIRED, CANCELED, and INCOMPLETE are distinct; CANCELLED is normalized to CANCELED.';

notify pgrst, 'reload schema';

commit;
