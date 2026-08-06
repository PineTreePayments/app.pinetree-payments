# `docs/skills/` — LEGACY. NOT AUTHORITATIVE.

**Do not treat any file in this folder as a current rule.**

These eight files were written as agent role-prompts (`# ROLE: Engine`,
`# ROLE: Provider`, …) in April 2026. They were never loaded by anything — no
script, no test, no configuration, no agent tool has ever read them. Six have
not been edited since 2026-04-23; the two Solana files since 2026-04-29.

They are retained for history. Nothing here is deleted.

## Where authority actually lives

| Need | Read |
|---|---|
| What every agent must do | [`AGENTS.md`](../../AGENTS.md) |
| Canonical standards and authority order | [`docs/standards/README.md`](../standards/README.md) |
| Which documents apply to your task | [`.ai/task-map.json`](../../.ai/task-map.json) via `npm run ai:preflight` |
| Every document's classification | [`docs/INDEX.md`](../INDEX.md) |

## Why these files are unsafe to follow

**1. They are stale.** The six role files predate the current canonical payment
vocabulary. `docs/skills/database.md` describes a world with no `INCOMPLETE`,
`EXPIRED`, or `CANCELED` states. [Standard 02](../standards/02-lifecycle-and-merchant-status.md)
defines eight canonical states plus an `Unmapped → Unknown` projection. An agent
following the skill file would not know most of the state machine exists.

**2. The two Solana files directly contradict each other**, and each forbids the
other's live production code:

- `solana-pay.md` — the `solana:` URI is "REQUIRED for mobile checkout"; "NEVER
  use wallet-specific deep links"; Phantom/Solflare deeplinks listed as
  "Forbidden".
- `solana-wallet-signing.md` — "Forbidden: Solana Pay `solana:` URI"; prescribes
  `phantom://browse/`.

Neither declares precedence over the other. **Both describe real, live code.**
Acting on either one in isolation would delete a working path.

The actual design is a per-wallet strategy registry documented in
[`docs/domains/solana-wallet-routing.md`](../domains/solana-wallet-routing.md),
based on `lib/wallets/paymentAppRegistry.ts`. Read that instead.

**3. They are structurally redundant.** The six role files are subsets of
[Standard 01 §2 and §6](../standards/01-platform-architecture.md#2-canonical-architecture)
and the Critical Rules in [`docs/architecture.md`](../architecture.md), both of
which are current and far more complete.

## If you are an agent

Do not use these files as instructions. Do not modify production code to satisfy
them. Do not "reconcile" the two Solana files — that is a documented divergence,
not a cleanup task.

These files are excluded from routing in
[`.ai/task-map.json`](../../.ai/task-map.json) (`exclusions.never` and
`exclusions.neverGlobs`), and `npm run ai:governance:check` fails if any of them
is ever routed as current authority.

## File inventory

| File | Lines | Last change | Status |
|---|---|---|---|
| `api.md` | 13 | 2026-04-23 | Superseded by Standard 01 §2 |
| `database.md` | 9 | 2026-04-23 | Superseded by Standards 01, 04 |
| `engine.md` | 17 | 2026-04-23 | Superseded by Standard 01 §6 |
| `providers.md` | 15 | 2026-04-23 | Superseded by Standard 05 |
| `watcher.md` | 18 | 2026-04-23 | Superseded by Standard 05 §4–5 |
| `webhook.md` | 15 | 2026-04-23 | Superseded by Standard 05 §4 |
| `solana-pay.md` | 51 | 2026-04-29 | Conflicting — see above |
| `solana-wallet-signing.md` | 37 | 2026-04-29 | Conflicting — see above |
