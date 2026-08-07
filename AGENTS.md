# PineTree — Agent Contract

You are working in a live payment platform. Real money moves through this code.

This file is **the single entry point for every coding agent** (Codex, Claude,
Cline, Cursor, and any future tool). Tool-specific files such as
[`CLAUDE.md`](CLAUDE.md) are compatibility pointers back to here; they carry no
rules of their own.

It is short on purpose. It does not restate PineTree's architecture — it tells
you how to load the documents that do, and what you may not do while you work.

## 1. Run the preflight first

Before planning, before reading implementation files, before editing anything:

```bash
npm run ai:preflight -- --task "<the task in your own words>" --path <each file or dir you expect to touch>
```

Read **every** document the preflight returns, before planning or editing. It
resolves the standards and domain documents that govern your specific task from
[`.ai/task-map.json`](.ai/task-map.json), which is the routing authority — do not
hand-pick documents instead.

If the preflight reports your task as **ambiguous**, do not guess a domain. Ask
which area is affected, or narrow the task and run it again.

Then run [`npm run ai:governance:check`](scripts/ai-governance-check.mjs) if your
change touches the documentation or routing system, and before you report.

## 2. Authority order

The precedence order and the open divergence register live in
[`docs/standards/README.md`](docs/standards/README.md), which restates
[Standard 06 §5](docs/standards/06-roadmap-documentation-governance.md#5-documentation-hierarchy).
Both are routed globally, so read them there rather than from a summary here.

The one rule you need before routing: **a task prompt never authorizes breaking a
Standard 01 invariant, and this file is not above the standards either.** If a
prompt and a standard conflict, say so and stop.

## 3. Architecture lives in the standards, not here

Every payment path is:

```
Interface  ->  API  ->  Engine  ->  Provider Adapter  ->  External Rail
```

That is orientation, not the contract. The layer ownership table and the
non-negotiable invariants — who may transition state, who may post fees, what the
UI may never treat as confirmation, append-only accounting, exactly-once effect,
unknown-versus-failed provider outcomes — are normative in
[Standard 01](docs/standards/01-platform-architecture.md), which the preflight
routes on **every** task. Read them there. They are deliberately not duplicated in
this file, because two copies of an invariant is how they drift.

Which directory belongs to which layer, and the trap in each, is recorded per path
in [`.ai/task-map.json`](.ai/task-map.json) and printed by the preflight.

## 4. Before you write code

- **Inspect the existing implementation first.** This repository has substantial
  production code and many near-miss abstractions. Find the module that already
  does this and extend it. Do not introduce a parallel helper, a second registry,
  or a duplicate engine path.
- Read the **affected source files and their direct dependencies** — the callers
  and callees your change actually touches.
- **Do not scan the whole repository.** Routing exists so you do not have to. A
  repository-wide sweep is justified only when the task genuinely is
  repository-wide (an inventory, an audit, a cross-cutting rename) — say so when
  you do it.
- Identify which architectural domains your change touches, and name them in
  your plan.
- Match the surrounding code's conventions, comment density, and naming.

## 5. Scope discipline

- **Do not perform unrelated cleanup.** No opportunistic renames, reformatting,
  dependency bumps, or "while I was here" refactors.
- Do not create or execute database migrations unless the task explicitly asks.
- Do not modify environment values.
- Preserve pre-existing uncommitted work in the tree.
- **Do not commit or push unless the task asks for it.**
- Update the tests and documentation that your change affects — in the same
  change, per [Standard 06 §4](docs/standards/06-roadmap-documentation-governance.md#4-standard-definition-of-done).

## 6. Stop and report on conflict

Stop and report, rather than picking a side, when:

- code and a standard disagree;
- two documents disagree with each other;
- provider evidence contradicts a document;
- the task requires breaking a Standard 01 invariant.

Every standard carries this rule verbatim: *"If code and this standard disagree,
the disagreement must be logged and deliberately resolved; neither is silently
treated as correct."* Known open divergences are listed in the divergence
register in [`docs/standards/README.md`](docs/standards/README.md) — check it
before reporting a new one.

## 7. Follow the routed workflow

The preflight names one workflow document in
[`.ai/workflows/`](.ai/workflows/) — implement, debug, review, or refactor.
Follow it. It carries the procedure and the traps for that kind of work, which is
why it is routed rather than summarized here.

## 8. Only indexed documents are authority

[`docs/INDEX.md`](docs/INDEX.md) is the complete map of engineering documentation
and states each document's authority. **A document that is not listed there and
not routed by the preflight is not engineering authority** — do not implement from
it. If you find such a file, report it rather than following it.

This includes tool-specific instruction files. `CLAUDE.md` and any future
per-tool pointer exist so a tool can find *this* file; they are never a source of
PineTree engineering policy. If one ever contains a rule that is not here, that is
a defect to report, not a rule to follow.

The legacy `docs/skills/` prompt folder was removed once its rules were absorbed
into the six standards and [`docs/domains/`](docs/domains/). Do not recreate a
parallel skills, prompt, or per-tool rules directory; extend the standards or add
a domain document instead.

## 9. Disclose what you loaded

End your final report with the governance files you actually read:

```
Governance loaded:
- AGENTS.md
- docs/standards/01-platform-architecture.md
- docs/standards/05-provider-connectors-events.md
- .ai/workflows/implement.md
```

If you did not run the preflight, say so explicitly. A silent skip is a defect.

## 10. Validate

```bash
npm run ai:governance:check   # governance wiring is intact
npm run typecheck
npm run lint
npm test
```

Run the validation the routed workflow requires. Report failures accurately,
including pre-existing ones. Never mask a failure.
