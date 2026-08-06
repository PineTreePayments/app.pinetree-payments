# Workflow — Refactor

Restructuring **without** behavior change. Read after the preflight output,
alongside [`AGENTS.md`](../../AGENTS.md).

## 1. The defining constraint

A refactor that changes observable behavior is not a refactor. In this repository
"observable" includes:

- any canonical state transition or its timing;
- any fee amount, posting key, or accounting entry;
- any merchant-visible label, color, or terminal copy;
- any provider request shape, header, or idempotency key;
- any public API response body, status code, or webhook payload;
- any database row written, or its ordering within a transaction.

If the restructure would alter any of these, stop. It is a behavior change and
needs the [implement](./implement.md) workflow and an explicit decision.

## 2. Establish the current contract before moving anything

- Read the standards the preflight returned, so you can tell an invariant from an
  accident of implementation.
- Identify the tests that currently pin the behavior. If a path has no test,
  **add the characterization test before refactoring**, not after.
- Be aware that some tests assert documentation prose
  (`__tests__/apiDocsReference.test.ts`). Moving a doc heading can fail CI.

## 3. Legitimate targets

- Collapsing genuine duplicate logic into the layer that owns it.
- Moving a decision into its correct layer — e.g. status derivation out of a
  component and into the shared presentation contract.
- Replacing a manually maintained list with a derivation from a canonical source.
- Narrowing types, removing dead branches, clarifying names.

## 4. Anti-targets

- **Do not "reconcile" a document with code.** If they disagree, that is a
  reportable divergence, not a refactor. See the register in
  [`docs/standards/README.md`](../../docs/standards/README.md).
- **Do not delete or rewrite a legacy document** to tidy the tree. Classification
  lives in [`docs/INDEX.md`](../../docs/INDEX.md); retention is deliberate.
- **Do not implement from an unindexed document.** If a file is not listed in
  [`docs/INDEX.md`](../../docs/INDEX.md) and not routed by the preflight, it is not
  authority — report it instead of acting on it. The legacy `docs/skills/` folder
  was removed for exactly this reason: two of its files forbade live production
  code paths, so satisfying one would have broken the other.
- Do not bundle dependency upgrades, formatting sweeps, or renames the task did
  not ask for.
- Do not create a new abstraction with a single caller.

## 5. Preserve deliberate oddities

Some surprising code is load-bearing and documented. Before "correcting" it,
search for a comment or ADR explaining it:

- `ledger_journal_entries` vs the standard's `ledger_entries` is deliberate — see
  [ADR-0001](../../docs/architecture/adr-0001-ledger-journal-entries.md), which
  exists mainly so a future reader does not "fix" the naming by accident.
- `public.ledger_entries` is retained as a legacy compatibility projection, not
  dead code. Same ADR.
- `MobileOpenStrategy` in `lib/wallets/paymentAppRegistry.ts` declares
  `solana_uri`, which no wallet record currently uses. It is not dead — the
  `solana:` URI is emitted outside the registry for QR encoding and generic
  handoff. See
  [`docs/domains/solana-wallet-routing.md`](../../docs/domains/solana-wallet-routing.md).

If you cannot find a rationale, ask before removing. Unexplained code in a
payments system is more often a scar than a mistake.

## 6. Prove equivalence

- The existing test suite must pass **unchanged**. Needing to edit an assertion
  is evidence that behavior moved.
- Run the full gate:

```bash
npm run typecheck
npm run lint
npm test
```

State explicitly that no observable behavior changed, and name what you verified
that against. Then disclose the governance files you loaded, per `AGENTS.md` §7.
