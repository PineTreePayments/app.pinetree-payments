-- Atomic, race-free claiming of wallet_sweep_jobs rows for the cron
-- processor (app/api/cron/process-wallet-sweeps/route.ts). This repo has no
-- raw psql/pg driver access anywhere - only PostgREST via
-- @supabase/supabase-js - and PostgREST cannot express `SELECT ... FOR
-- UPDATE SKIP LOCKED` directly. A single-statement `UPDATE ... WHERE id IN
-- (SELECT ... FOR UPDATE SKIP LOCKED)` run as a Postgres function exposed via
-- supabase.rpc(...) is the only way to get real row-locking semantics
-- through this repo's DB access, so two overlapping cron invocations (or a
-- manual retrigger while cron is also running) can never claim the same job
-- twice. This is a new infrastructure pattern for this codebase - no other
-- supabase.rpc(...) call exists yet - so it has a dedicated concurrency test
-- (__tests__/walletSweepClaim.test.ts) that must pass before anything else
-- depends on it.

create or replace function public.claim_wallet_sweep_jobs(p_limit int, p_now timestamptz default now())
returns setof public.wallet_sweep_jobs
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.wallet_sweep_jobs
  set status = 'PROCESSING',
      claimed_at = p_now,
      attempt_count = attempt_count + 1,
      updated_at = p_now
  where id in (
    select id from public.wallet_sweep_jobs
    where status = 'QUEUED' and not_before <= p_now
    order by not_before asc, created_at asc
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning *;
$$;

revoke all on function public.claim_wallet_sweep_jobs(int, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_wallet_sweep_jobs(int, timestamptz) to service_role;

comment on function public.claim_wallet_sweep_jobs(int, timestamptz) is
  'Atomically claims up to p_limit QUEUED wallet_sweep_jobs rows (flips them to PROCESSING) using SKIP LOCKED so concurrent cron invocations never double-claim. Call via supabaseAdmin.rpc only.';

-- Reclaims jobs stuck in PROCESSING past a timeout (e.g. a cron invocation
-- crashed or timed out before it could mark the job CONFIRMED/FAILED). Does
-- not need SKIP LOCKED / a row-returning claim contract since it doesn't
-- hand work back to a caller - it just makes stalled rows eligible for the
-- next normal claim pass again. attempt_count is left as-is from the
-- original claim, so a max-attempts check downstream can eventually route a
-- repeatedly-stalling job to FAILED/BLOCKED instead of retrying forever.
create or replace function public.reset_stalled_wallet_sweep_jobs(p_stalled_after_seconds int default 600)
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  with reset as (
    update public.wallet_sweep_jobs
    set status = 'QUEUED',
        claimed_at = null,
        updated_at = now()
    where status = 'PROCESSING'
      and claimed_at is not null
      and claimed_at < now() - make_interval(secs => greatest(p_stalled_after_seconds, 0))
    returning id
  )
  select count(*)::int from reset;
$$;

revoke all on function public.reset_stalled_wallet_sweep_jobs(int) from public, anon, authenticated;
grant execute on function public.reset_stalled_wallet_sweep_jobs(int) to service_role;

comment on function public.reset_stalled_wallet_sweep_jobs(int) is
  'Reclaims wallet_sweep_jobs stuck PROCESSING past p_stalled_after_seconds (default 10 minutes), returning them to QUEUED. Returns the number of jobs reset. Call via supabaseAdmin.rpc only.';
