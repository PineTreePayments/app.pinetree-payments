# PineTree Wallet — Address Book, Fee-Aware Max, and Automatic Sweeps

Implemented 2026-07-21. This is a distinct, new feature from the legacy
`merchant_lightning_sweeps` system (see `lightning-sweep-env-checklist.md`) —
that table swept a Speed connected-account balance to a PineTree-hosted
BOLT11 invoice under a pre-pivot architecture and is now dead code, superseded
by Speed's connected-account balance directly being the merchant's BTC
wallet. This feature sweeps CONFIRMED balance on any rail (Base, Solana,
Bitcoin) out to a merchant's own external, confirmed address-book
destination, on a schedule the merchant configures.

## Required SQL — must be run manually in the Supabase SQL editor

This repo has no migration runner (no `psql`/`supabase` CLI/`DATABASE_URL`).
Apply these in order (the first is from an earlier, already-committed session
and — as of this feature's implementation — was still unapplied to the live
database; verify with a PostgREST probe before assuming otherwise):

1. `database/migrations/20260720_create_merchant_withdrawal_destinations.sql`
2. `database/migrations/20260721_extend_merchant_withdrawal_destinations.sql`
3. `database/migrations/20260721_add_canonical_withdrawal_columns.sql`
4. `database/migrations/20260721_create_wallet_sweep_tables.sql`
5. `database/migrations/20260721_create_claim_wallet_sweep_jobs_fn.sql`

After applying, register the cron schedule directly in the Supabase SQL
editor (not checked into this repo, matching how the two existing live cron
jobs — `sweep-stale-payments`, `check-payments` — are scheduled):

```sql
select cron.schedule(
  'process-wallet-sweeps',
  '*/2 * * * *', -- every 2 minutes
  $$
  select net.http_post(
    url := 'https://<your-production-domain>/api/cron/process-wallet-sweeps',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    )
  );
  $$
);
```

Adjust the Vault secret lookup to match however `CRON_SECRET` is already
stored for the existing two cron jobs in this project's Supabase instance.

## Automatic sweep capability matrix — read before enabling anything

| Rail | Execution | Why |
|---|---|---|
| Bitcoin (Speed custodial sub-account) | **Fully unattended.** Cron claims the job and calls Speed server-side — no browser needed. | Speed custodies the funds; PineTree already has a working server-side signer (`speedConnectedAccountWithdrawalSigner`). |
| Base ETH/USDC | **Requires an active Wallet session.** Cron only re-confirms eligibility and releases the job back to `QUEUED`/`AWAITING_GAS`; actual submission happens client-side the next time the merchant opens the Wallet page with a matching Dynamic embedded wallet ready. | Confirmed by reading `providers/wallets/withdrawalSigner.ts`: `dynamicBrowserWithdrawalSigner.submitWithdrawal` throws by design if called without a browser session. No server-side/headless/MPC signing capability exists anywhere in this repo for Dynamic. |
| Solana SOL/USDC | Same as Base — session-gated, not unattended. | Same reason. |

This asymmetry is surfaced verbatim in the Automatic Settlement tab UI copy
— do not present Base/Solana sweeps as equivalent to Bitcoin's unattended
behavior.

## Environment variables

All are server-only feature-local getters (mirroring `engine/lightningSweep.ts`'s
existing pattern), read directly from `process.env` — none need a
`NEXT_PUBLIC_` prefix and none are exposed to the browser.

| Variable | Purpose | Default |
|---|---|---|
| `WALLET_SWEEP_ENABLED` | Kill switch for the entire automatic-sweep subsystem (rule evaluation is a no-op when unset/false). Independent of the unrelated legacy `SPEED_LIGHTNING_SWEEP_ENABLED`. | `false` |
| `BASE_ETH_MIN_RESERVE` | ETH left unspent on Base withdrawals/sweeps as a safety reserve. | `0.0003` |
| `SOLANA_SOL_MIN_RESERVE` | SOL left unspent on Solana withdrawals/sweeps as a safety reserve. | `0.002` |
| `WITHDRAWAL_FEE_SAFETY_MULTIPLIER` | Multiplier applied to the RPC-estimated Base/Solana network fee before subtracting it from Max. | `1.3` |
| `BTC_MAX_WITHDRAWAL_FEE_BUFFER_SATS` | Conservative static buffer for Bitcoin Max, since Speed has no pre-flight fee-quote endpoint (fees are only returned after execution). | `500` |
| `MIN_SWEEP_VALUE_USD` | Minimum USD value an evaluated sweep must clear before being queued. | `5` |
| `WALLET_SWEEP_MAX_ATTEMPTS` | Max retry attempts for a Bitcoin sweep job before it's marked permanently `FAILED`. | `5` |
| `CRON_SECRET` | Already exists for the other two cron routes — reused as-is for `process-wallet-sweeps`. | — |
| `RESEND_API_KEY`, `PINETREE_FROM_EMAIL` | Already exist — reused by `lib/email/sendWalletSecurityNotification.ts`. Notifications no-op gracefully (never throw) if unset. | — |

`max_daily_sweep_usd` (a per-rule safety cap) and `min_remaining_reserve_decimal`
are configured per sweep rule, not globally — set via the Automatic Settlement
UI or the `sweep-rules` API, not an env var.

## Security notes — read before treating "enable automatic sweeps" as equivalent to real step-up auth

This repo has **no reauthentication, email-code, or 2FA system anywhere**
(confirmed by broad search across the codebase). `lib/api/merchantAuth.ts`
only validates that a bearer token is currently valid — no freshness/step-up
check exists. Enabling a sweep rule therefore uses the strongest available
substitute: a server-enforced typed-confirmation phrase
(`engine/withdrawals/walletSweepRules.ts`'s `SWEEP_RULE_ACKNOWLEDGMENT_PHRASE`),
never trusted client-side-only, plus an audit event and a best-effort email
notification. This is explicitly **not** equivalent to real step-up
authentication — if a genuine reauth system is ever built, wire it in here
instead of (or in addition to) the typed phrase.

## Idempotency

- Every sweep job has a deterministic `idempotency_key`:
  `sweep:{ruleId}:payment:{paymentId}` (per-payment) or
  `sweep:{ruleId}:period:{isoDate}` (threshold/daily) — safe against webhook
  retries, cron retries, and duplicate payment-confirmation events.
- Job claiming is atomic via the `claim_wallet_sweep_jobs` Postgres function
  (`SKIP LOCKED`) — the only way to get real row-locking through this repo's
  PostgREST-only DB access. Two overlapping cron invocations can never claim
  the same job.
- Bitcoin execution re-derives a stable per-job idempotency key
  (`withdrawal-for-sweep:{jobId}`) before calling the canonical withdrawal
  dispatcher, so a retried/stuck job never double-submits to Speed.
