-- Automatic Settlement / automatic sweeps: rules a merchant configures
-- (threshold, daily, per-payment, or manual-only) and the jobs those rules
-- produce. Jobs never move funds themselves - execution always goes through
-- the same canonical withdrawal dispatcher used by manual and saved-address
-- withdrawals (engine/withdrawals/canonicalWithdrawal.ts). This is a
-- distinct, new concept from the legacy, disabled merchant_lightning_sweeps
-- table (which swept a Speed balance to a PineTree-hosted invoice, under a
-- pre-pivot architecture) - do not confuse the two or repurpose either.

create table public.wallet_sweep_rules (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  rail text not null check (rail in ('base', 'solana', 'bitcoin')),
  asset text not null check (asset in ('ETH', 'USDC', 'SOL', 'BTC')),
  destination_id uuid not null references public.merchant_withdrawal_destinations(id),
  is_enabled boolean not null default false,
  mode text not null check (mode in ('manual', 'threshold', 'daily', 'per_payment')),
  threshold_amount_decimal text,
  scheduled_time_utc time,
  min_remaining_reserve_decimal text not null default '0',
  -- Independent safety net beyond min_remaining_reserve: caps total sweep
  -- value per calendar day so a threshold-evaluation bug can't drain an
  -- account unattended before a human notices. Null = no cap (discouraged;
  -- the UI should always suggest a value).
  max_daily_sweep_usd numeric,
  -- Verbatim copy of the confirmation phrase the merchant typed when
  -- enabling this rule - the server-enforced substitute for the reauth/
  -- email-code system this repo does not have (see docs/environment for the
  -- documented limitation). Never trust client-only enforcement of this.
  acknowledgment_text text not null,
  acknowledged_at timestamptz not null,
  last_evaluated_at timestamptz,
  last_executed_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_sweep_rules_threshold_requires_amount
    check (mode <> 'threshold' or threshold_amount_decimal is not null),
  constraint wallet_sweep_rules_daily_requires_time
    check (mode <> 'daily' or scheduled_time_utc is not null)
);

-- One ENABLED rule per (merchant, rail, asset) - prevents ambiguous or
-- competing automation targeting the same balance. A merchant may still
-- have multiple disabled/historical rules for the same pair.
create unique index wallet_sweep_rules_one_active_per_asset_idx
  on public.wallet_sweep_rules (merchant_id, rail, asset)
  where is_enabled = true;

create index wallet_sweep_rules_merchant_idx on public.wallet_sweep_rules (merchant_id);
create index wallet_sweep_rules_destination_idx on public.wallet_sweep_rules (destination_id);

create table public.wallet_sweep_jobs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.wallet_sweep_rules(id),
  merchant_id uuid not null,
  rail text not null check (rail in ('base', 'solana', 'bitcoin')),
  asset text not null check (asset in ('ETH', 'USDC', 'SOL', 'BTC')),
  status text not null default 'QUEUED' check (status in (
    'QUEUED', 'AWAITING_FINALITY', 'AWAITING_GAS', 'PROCESSING',
    'CONFIRMED', 'FAILED', 'CANCELLED', 'BLOCKED'
  )),
  amount_decimal text not null,
  -- Deterministic, not random: sweep:{ruleId}:payment:{paymentId} for
  -- per_payment, sweep:{ruleId}:period:{isoDate} for threshold/daily. This
  -- is what makes it safe to evaluate eligibility from more than one
  -- payment-confirmation code path without ever double-queuing the same
  -- funds - see engine/withdrawals/walletSweepEvaluation.ts.
  idempotency_key text not null,
  trigger_kind text not null check (trigger_kind in ('payment_confirmed', 'threshold', 'daily', 'manual_test')),
  trigger_payment_id uuid,
  trigger_balance_snapshot jsonb,
  -- Cannot be a single FK: the resulting withdrawal lands in one of two
  -- separate tables depending on rail. Always resolve both together via one
  -- helper (database/walletSweepJobs.ts's resolveSweepJobWithdrawal) rather
  -- than querying either table directly from job rows.
  withdrawal_source_table text check (withdrawal_source_table in ('wallet_withdrawal_requests', 'merchant_wallet_operations')),
  withdrawal_id uuid,
  attempt_count int not null default 0,
  claimed_at timestamptz,
  not_before timestamptz not null default now(),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index wallet_sweep_jobs_idempotency_idx
  on public.wallet_sweep_jobs (merchant_id, idempotency_key);

-- Claim-query index: the cron job scans only QUEUED rows whose not_before
-- has passed, oldest first.
create index wallet_sweep_jobs_claim_idx
  on public.wallet_sweep_jobs (status, not_before, created_at)
  where status = 'QUEUED';

-- Stalled-job reaper scan index (PROCESSING rows stuck past a timeout).
create index wallet_sweep_jobs_processing_idx
  on public.wallet_sweep_jobs (status, claimed_at)
  where status = 'PROCESSING';

create index wallet_sweep_jobs_merchant_idx on public.wallet_sweep_jobs (merchant_id, created_at desc);
create index wallet_sweep_jobs_rule_idx on public.wallet_sweep_jobs (rule_id, created_at desc);

create table public.wallet_sweep_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.wallet_sweep_jobs(id),
  from_status text,
  to_status text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index wallet_sweep_events_job_idx on public.wallet_sweep_events (job_id, created_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger wallet_sweep_rules_updated_at
  before update on public.wallet_sweep_rules
  for each row execute function public.set_updated_at();

create trigger wallet_sweep_jobs_updated_at
  before update on public.wallet_sweep_jobs
  for each row execute function public.set_updated_at();

-- Full lockdown RLS, matching every other fund-movement/destination table in
-- this repo (merchant_withdrawal_destinations, merchant_speed_credentials,
-- merchant_lightning_sweeps): no CREATE POLICY at all, service-role-only
-- access via database/walletSweepRules.ts / walletSweepJobs.ts, gated by
-- requireMerchantIdFromRequest at the API layer.
alter table public.wallet_sweep_rules enable row level security;
alter table public.wallet_sweep_jobs enable row level security;
alter table public.wallet_sweep_events enable row level security;

revoke all on public.wallet_sweep_rules from anon, authenticated;
revoke all on public.wallet_sweep_jobs from anon, authenticated;
revoke all on public.wallet_sweep_events from anon, authenticated;

comment on table public.wallet_sweep_rules is
  'Merchant-configured automatic sweep rules (manual/threshold/daily/per_payment) targeting a confirmed address-book destination. Service-role access only.';
comment on table public.wallet_sweep_jobs is
  'Queued/executed instances of a sweep rule firing. Execution always goes through the canonical withdrawal dispatcher, never a separate provider call. Service-role access only.';
comment on table public.wallet_sweep_events is
  'Append-only state-transition audit trail for wallet_sweep_jobs. Service-role access only.';
