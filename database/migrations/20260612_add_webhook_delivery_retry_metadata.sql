alter table public.webhook_deliveries
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_status_code integer,
  add column if not exists last_error text,
  add column if not exists delivered_at timestamptz;

update public.webhook_deliveries
set
  last_attempt_at = coalesce(last_attempt_at, updated_at, created_at),
  last_status_code = coalesce(last_status_code, response_status),
  delivered_at = case
    when status = 'delivered' then coalesce(delivered_at, updated_at, created_at)
    else delivered_at
  end,
  next_attempt_at = case
    when status = 'failed' then coalesce(next_attempt_at, now())
    else null
  end
where
  last_attempt_at is null
  or last_status_code is null
  or (status = 'delivered' and delivered_at is null)
  or (status = 'failed' and next_attempt_at is null);

create index if not exists webhook_deliveries_retry_eligible_idx
  on public.webhook_deliveries (status, next_attempt_at)
  where status = 'failed';

comment on column public.webhook_deliveries.next_attempt_at is
  'Earliest time an automated or manual retry should be attempted.';
