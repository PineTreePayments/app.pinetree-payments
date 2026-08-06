# PineTree — Agent Contract

You are working in a live payment platform. Real money moves through this code.
This file is the entry point for every coding agent (Codex, Claude, Cline,
Cursor, and any future tool). It is short on purpose. It tells you what to load
and what you may not do.

## 1. Run the preflight first

Before planning, before reading implementation files, before editing anything:

```bash
npm run ai:preflight -- --task "<the task in your own words>" --path <each file or dir you expect to touch>
```

Read **every** document the preflight returns. It resolves the standards and
domain documents that govern your specific task from
[`.ai/task-map.json`](.ai/task-map.json).

If the preflight reports your task as **ambiguous**, do not guess a domain. Ask
which area is affected, or narrow the task and run it again.

## 2. Authority order

Defined in [`docs/standards/README.md`](docs/standards/README.md), which
restates [Standard 06 §5](docs/standards/06-roadmap-documentation-governance.md#5-documentation-hierarchy):

1. [Platform Architecture Standard](docs/standards/01-platform-architecture.md)
2. Domain standards 02–06 in [`docs/standards/`](docs/standards/)
3. Accepted ADRs in [`docs/architecture/`](docs/architecture/)
4. Executable truth — `docs/api/openapi.yaml`, `database/migrations/`, provider contracts
5. Runbooks, test plans, presentation references
6. Task prompts and this file

**A task prompt never authorizes breaking a Standard 01 invariant.** If a prompt
and a standard conflict, say so and stop.

## 3. Architectural boundaries

Every payment path is:

```
Interface  ->  API  ->  Engine  ->  Provider Adapter  ->  External Rail
```

| Layer | Owns | Must not own |
|---|---|---|
| Interface (`app/`, `components/`) | Presentation, merchant display | Provider secrets, finality decisions, fee posting, canonical transitions |
| API (`app/api/`) | Auth, validation, request envelope, idempotency entry | Provider business logic, independent state machines |
| Engine (`engine/`) | Routing, fee policy, canonical transitions, event processing, posting orchestration | UI state, provider SDK leakage |
| Provider adapters (`providers/`) | External auth, request translation, signature verification, lookup, normalized events | Merchant presentation, canonical transition authority |
| Data (`database/`) | Durable intent, event inbox, ledger, read models, audit | Inventing provider outcomes without verified evidence |

Rules that follow from this, and that you must not violate:

- **Canonical state transitions and fee posting stay in the Engine.** Providers,
  webhooks, watchers, and UI never write payment status.
- **Provider adapters are limited to** external authentication, request
  translation, signature verification, lookup, and returning normalized events.
  Provider SDK objects do not cross the adapter boundary; normalized types do.
- **The UI never reports success from a client-side action alone.** Wallet
  connection, wallet return, browser focus, ERC-20 approval, and a submitted
  transaction are not confirmation. A Base USDC approval hash must never be
  stored as the payment hash.
- **Accounting is append-only.** Corrections are new reversing entries, never
  edits. Money is integer minor/base units with explicit asset, network, and
  precision. The `payments` table is not the ledger.
- **Duplicate events must not double-post** a platform fee or a merchant
  balance. Business effects are exactly-once via uniqueness constraints and
  transactional processing.
- Provider timeout is an **unknown** outcome until a lookup resolves it. It is
  not automatically a failure.

## 4. Before you write code

- **Inspect the existing implementation first.** This repository has substantial
  production code and many near-miss abstractions. Find the module that already
  does this and extend it. Do not introduce a parallel helper, a second registry,
  or a duplicate engine path.
- Identify which architectural domains your change touches, and name them in
  your plan.
- Match the surrounding code's conventions, comment density, and naming.

## 5. Scope discipline

- **Do not perform unrelated cleanup.** No opportunistic renames, reformatting,
  dependency bumps, or "while I was here" refactors.
- Do not create or execute database migrations unless the task explicitly asks.
- Do not modify environment values.
- Preserve pre-existing uncommitted work in the tree.
- Update the tests and documentation that your change affects — in the same
  change, per [Standard 06 §4](docs/standards/06-roadmap-documentation-governance.md#4-standard-definition-of-done).

## 6. Stop and report on conflict

Stop and report, rather than picking a side, when:

- code and a standard disagree;
- two documents disagree with each other;
- provider evidence contradicts a document;
- the task requires breaking an invariant in section 3.

Every standard carries this rule verbatim: *"If code and this standard disagree,
the disagreement must be logged and deliberately resolved; neither is silently
treated as correct."* Known open divergences are listed in the divergence
register in [`docs/standards/README.md`](docs/standards/README.md) — check it
before reporting a new one.

## 7. Disclose what you loaded

End your final report with the governance files you actually read:

```
Governance loaded:
- AGENTS.md
- docs/standards/01-platform-architecture.md
- docs/standards/05-provider-connectors-events.md
- .ai/workflows/implement.md
```

If you did not run the preflight, say so explicitly. A silent skip is a defect.

## 8. Legacy content that is not authority

- [`docs/skills/`](docs/skills/) is **legacy and disconnected**. It is not loaded
  by anything, is frozen since April 2026, and its two Solana files contradict
  each other and current code. See [`docs/skills/README.md`](docs/skills/README.md).
- Document classification — canonical, scoped, operational, historical,
  superseded — is in [`docs/INDEX.md`](docs/INDEX.md). Check a document's class
  before treating it as current.

## 9. Validate

```bash
npm run ai:governance:check   # governance wiring is intact
npm run typecheck
npm run lint
npm test
```

Report failures accurately, including pre-existing ones. Never mask a failure.
