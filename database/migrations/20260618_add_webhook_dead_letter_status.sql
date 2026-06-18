alter table public.webhook_deliveries
  add column if not exists dead_lettered_at timestamptz;

alter table public.webhook_deliveries
  drop constraint if exists webhook_deliveries_status_check;

alter table public.webhook_deliveries
  add constraint webhook_deliveries_status_check
  check (status in ('pending', 'delivered', 'failed', 'dead_letter'));

create index if not exists webhook_deliveries_dead_lettered_at_idx
  on public.webhook_deliveries(dead_lettered_at)
  where status = 'dead_letter';
