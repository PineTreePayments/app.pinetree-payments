# Workflow — Implement

Adding or changing behavior. Read after the preflight output, alongside
[`AGENTS.md`](../../AGENTS.md).

## 1. Establish authority before design

- Read every document the preflight returned. Standards first, then ADRs, then
  executable truth (`openapi.yaml`, migrations, provider contracts).
- Check the divergence register in
  [`docs/standards/README.md`](../../docs/standards/README.md). If your task
  touches an open divergence (D-2, D-3, D-4), say so before proposing a design.
- Confirm the document you are relying on is not classified Historical or
  Superseded in [`docs/INDEX.md`](../../docs/INDEX.md).

## 2. Find what already exists

This repository has many near-miss abstractions. Before creating anything:

- Search for the existing module that owns this concern. Prefer extending it.
- For wallet/rail routing, the strategy registry in `lib/wallets/` is the single
  source of truth — see
  [`docs/domains/solana-wallet-routing.md`](../../docs/domains/solana-wallet-routing.md).
- For merchant status labels, the shared presentation contract is authoritative.
  Do not add custom terminal copy, icons, or colors.
- Name the modules you inspected in your plan. "I could not find an existing
  owner" is a finding worth stating.

## 3. Place the change in the right layer

```
Interface  ->  API  ->  Engine  ->  Provider Adapter  ->  External Rail
```

Ask, in order:

1. Is this a **presentation** concern? → `app/`, `components/`. It may not decide
   finality or write status.
2. Is this **validation, auth, or envelope**? → `app/api/`. Thin wrapper only.
3. Is this a **canonical decision** — transition, fee, routing, event
   processing? → `engine/`. This is the only place that may transition state or
   post a fee.
4. Is this **external translation** — auth, request shaping, signature
   verification, lookup, event normalization? → `providers/`. No DB writes, no
   merchant labels, no SDK types crossing the boundary.
5. Is this **durable structure**? → `database/`. Do not author or execute a
   migration unless the task explicitly asks for one.

If a change seems to need two layers to share logic, that is a design signal —
state it rather than duplicating the logic.

## 4. Invariants to hold

- No client-side action means success. Wallet connection, wallet return, browser
  focus, approval, and a submitted transaction are not confirmation.
- A Base USDC approval hash is never stored as the payment hash.
- Duplicate events must not double-post a fee or a balance. Derive a
  deterministic idempotency/posting key.
- Accounting is append-only; corrections are new reversing entries.
- Money is integer minor/base units with explicit asset, network, and precision.
- A provider timeout is UNKNOWN until a lookup resolves it — never an automatic
  failure, never a blind resubmission.
- Tenancy is resolved server-side. Never trust a client-supplied `merchant_id`.

## 5. Finish the change

Per [Standard 06 §4](../../docs/standards/06-roadmap-documentation-governance.md#4-standard-definition-of-done),
these travel together in one change:

- Tests for the behavior, including the duplicate-event and failure paths.
- Documentation for anything whose contract moved. Note that several
  `docs/api/*` files are pinned by `__tests__/apiDocsReference.test.ts`.
- No unrelated cleanup, renames, reformatting, or dependency bumps.

## 6. Validate and report

```bash
npm run typecheck
npm run lint
npm test
```

Report pre-existing failures as pre-existing, with output. Then disclose the
governance files you loaded, as required by `AGENTS.md` §9.
