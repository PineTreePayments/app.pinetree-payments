# `.ai/` — Task Routing

This directory routes a task to the governance documents that must be read
before planning or editing PineTree.

| File | Purpose |
|---|---|
| [`task-map.json`](./task-map.json) | Lookup table: paths and domain keywords → required documents |
| [`workflows/implement.md`](./workflows/implement.md) | Adding or changing behavior |
| [`workflows/debug.md`](./workflows/debug.md) | Diagnosing a defect |
| [`workflows/review.md`](./workflows/review.md) | Reviewing a change against the standards |
| [`workflows/refactor.md`](./workflows/refactor.md) | Restructuring without behavior change |

## Nothing here loads automatically

`task-map.json` is **data**. It has no runtime, no hooks, and no ability to
inject context into any model. Saying otherwise would be the same mistake this
system was built to fix — the previous `docs/skills/` folder looked like agent
context but was never loaded by anything.

Enforcement is exactly two things:

1. **[`scripts/ai-preflight.mjs`](../scripts/ai-preflight.mjs)** — resolves the
   map and prints the required document set. Run via
   `npm run ai:preflight`.
2. **[`AGENTS.md`](../AGENTS.md)** — the root contract that requires an agent to
   run the preflight and read what it returns.

If an agent skips the preflight, nothing stops it. The contract asks the agent to
disclose that it skipped, and `npm run ai:governance:check` verifies the wiring
is intact — but the loop is cooperative, not enforced by the runtime.

## Usage

```bash
npm run ai:preflight -- --task "Add a FluidPay refund path" --path providers/fluidpay/refunds.ts
npm run ai:preflight -- --task "Investigate stuck Processing on Base" --path engine/basePayments.ts --path lib/wallets/
npm run ai:preflight -- --task "Modify checkout payment lifecycle" --path app/checkout/example.tsx --json
```

Flags:

| Flag | Meaning |
|---|---|
| `--task "<text>"` | Required. Free text; matched against domain keywords. |
| `--path <p>` | Repeatable. Files or directories you expect to touch. |
| `--json` | Machine-readable output instead of the printed report. |

## Resolution model

The document set is the **union** of three sources, then deduplicated:

1. `globalRequired` — always loaded.
2. Every `paths[]` entry whose glob matches any supplied `--path`. Matches are
   additive, so `app/checkout/foo.tsx` picks up both `app/**` and
   `app/checkout/**`.
3. Every `domains{}` entry whose keywords appear in the task text (word-boundary
   matched, case-insensitive).

`documents` are required reading. `optional` are surfaced separately as
recommended, so a provider-specific checklist does not crowd out a standard.

The workflow document is inferred from task keywords
(`workflowKeywords`), defaulting to `implement`.

Anything in `exclusions` is never routed. That list exists because the repository
still contains superseded and self-contradictory documents that read as though
they were current.

## Ambiguity is reported, never guessed

If no domain keyword matches and no `--path` is supplied, the preflight prints an
**AMBIGUOUS** section listing the available domains and does not invent a
routing. Narrow the task or pass paths, then run it again.

## Adding a route

1. Add the path glob or domain to `task-map.json`.
2. Reference only documents that exist — `npm run ai:governance:check` fails on a
   missing target.
3. Never reference anything in `exclusions`, `docs/archive/`, or `docs/skills/`.
4. Run `npm run ai:governance:check` and `npm test`.
