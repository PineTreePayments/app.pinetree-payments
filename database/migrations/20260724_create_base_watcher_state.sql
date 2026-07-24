-- Durable, cross-instance state for Base (ETH/USDC) on-chain confirmation
-- checks. Two problems this closes, both observed in production:
--
-- 1. The existing single-flight guard for watchPaymentOnce (see
--    engine/paymentMaintenance.ts's runPaymentWatcherThrottled) is an
--    in-memory Map on globalThis. That collapses concurrent callers within
--    ONE warm Vercel serverless instance, but does nothing across instances -
--    two different instances handling two nearly-simultaneous requests for
--    the same paymentId (e.g. a customer's own poll and a POS terminal's
--    poll) can each run a real watchPaymentOnce check at the same time.
--    base_watcher_leases gives every instance a shared, durable view of
--    "is a Base confirmation check already running for this payment right
--    now" via a simple insert-or-steal-if-expired claim.
--
-- 2. The chunked eth_getLogs fallback scan (engine/paymentWatcher.ts,
--    engine/baseChainReconciliation.ts) always walks backward from the
--    current block for a bounded number of chunks. With no persisted
--    cursor, every call re-scans the exact same newest blocks, so a
--    transaction whose block falls outside that per-call window is never
--    reachable by later calls even though total lookback keeps growing -
--    base_watcher_leases.reconcile_scanned_to_block lets
--    engine/baseChainReconciliation.ts remember where the previous call left
--    off and resume one chunk further back on each subsequent self-heal
--    pass, instead of being stuck re-scanning the same recent window.
create table if not exists public.base_watcher_leases (
  payment_id uuid primary key,
  locked_until timestamptz not null,
  reconcile_scanned_to_block bigint null,
  updated_at timestamptz not null default now()
);

create index if not exists base_watcher_leases_locked_until_idx
  on public.base_watcher_leases (locked_until);

alter table public.base_watcher_leases enable row level security;

-- No merchant, authenticated client, or anonymous access - this is purely
-- internal engine coordination state, never exposed through any API.
revoke all on public.base_watcher_leases from anon, authenticated;

comment on table public.base_watcher_leases is
  'Durable single-flight lease + fallback-scan resume cursor for Base payment confirmation checks (engine/checkPaymentOnce.ts, engine/baseChainReconciliation.ts). Service-role access only.';
