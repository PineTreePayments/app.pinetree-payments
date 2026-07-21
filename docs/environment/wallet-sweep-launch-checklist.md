# Launch Checklist — Wallet Address Book, Fee-Aware Max, Automatic Sweeps

See `wallet-sweep-env-checklist.md` for full env var / capability details.
This is the short, ordered "what the repo owner must actually do" list.

## Before anything works in production

- [ ] Run all 5 SQL files listed in `wallet-sweep-env-checklist.md`, in order,
      against the production Supabase project's SQL editor.
- [ ] Verify live via a PostgREST probe (e.g.
      `GET .../merchant_withdrawal_destinations?select=id&limit=1`) that each
      new/altered table actually exists before relying on the corresponding
      UI/API surface — none of this applies itself.
- [ ] Register the `process-wallet-sweeps` cron schedule (SQL provided in the
      env checklist) via `cron.schedule(...)` in the Supabase SQL editor.
- [ ] Confirm `CRON_SECRET` is set in the production environment (already
      required by the two existing cron routes — reused as-is here).

## Recommended rollout order

1. Ship with `WALLET_SWEEP_ENABLED` unset (defaults to disabled). Address
   Book, fee-aware Max, and manual/saved-address withdrawals all work
   immediately — none of that is gated by this flag.
2. Verify the Address Book end-to-end for a real (low-value) merchant: add a
   destination, confirm it, edit its label, disable/re-enable it, archive it.
3. Verify a saved-address withdrawal (Withdraw tab → pick a saved
   destination) for Base, Solana, and Bitcoin.
4. Verify the Max button against a real wallet with a nonzero balance for
   each of the 5 asset/rail combinations, including the Base-USDC/Solana-USDC
   insufficient-native-gas blocking message.
5. Only once the above are verified, set `WALLET_SWEEP_ENABLED=true` and
   create ONE low-value manual-mode sweep rule to confirm the full
   create → enable (typed confirmation) → pause flow before ever creating a
   threshold/daily/per-payment rule for a real merchant.
6. Watch the first few real cron ticks (`/api/cron/process-wallet-sweeps`
   response body, logged as `[cron:process-wallet-sweeps]`) before
   encouraging broader merchant adoption.

## Known limitations to communicate to support/merchants

- Base and Solana automatic sweeps are **not** unattended — they complete the
  next time the merchant has an active Wallet session with their embedded
  wallet ready. Only Bitcoin sweeps run fully in the background. This is a
  real architectural limit (no server-side signing capability for the
  self-custodial embedded wallet), not a bug.
- "Enable automatic sweeps" uses a typed-confirmation phrase, not real 2FA —
  this repo has no reauthentication/email-code system. Document this
  explicitly if merchants ask about security guarantees.
- Bitcoin's Max withdrawal amount uses a conservative static fee buffer, not
  a live Speed fee quote (Speed has no pre-flight fee-quote endpoint today).
- The generic `/api/wallets/withdrawals` route (Bitcoin manual withdrawals)
  keeps its exact existing request/response contract - saved-address and
  automatic-sweep withdrawals route through the new canonical dispatcher
  additively via an optional `destination_id`/job linkage, without changing
  that contract.
