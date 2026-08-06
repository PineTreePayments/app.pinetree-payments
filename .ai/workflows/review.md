# Workflow — Review

Reviewing a change against the standards. Read after the preflight output,
alongside [`AGENTS.md`](../../AGENTS.md).

## 1. Load the authority for the changed paths

Run the preflight with the paths the change actually touches, and read what it
returns. Reviewing against memory is how drift enters the codebase.

## 2. Boundary review

For each changed file, confirm it stayed inside its layer:

| Path | Must not |
|---|---|
| `app/`, `components/` | Decide finality, write payment status, compute fees, hold provider secrets, define custom terminal copy/colors |
| `app/api/` | Contain business logic or an independent state machine |
| `engine/` | Leak UI state or provider SDK types |
| `providers/` | Write the database, own merchant labels, expose SDK objects across the boundary |
| `database/` | Invent a provider outcome without verified evidence |

A change that moves a decision *down* a layer (UI deciding what the Engine should
decide) is the highest-severity finding in this repository.

## 3. Invariant checklist

- [ ] No success reported from a client-side action alone.
- [ ] Base USDC approval distinguished from the payment call; approval hash never
      stored as the payment hash.
- [ ] Duplicate event / duplicate request causes no second fee, balance change,
      notification, or outbound webhook.
- [ ] Posting and idempotency keys are deterministic.
- [ ] Money is integer minor/base units; no float is authoritative.
- [ ] Accounting additions are append-only; corrections reverse rather than edit.
- [ ] Timeout and unknown outcomes resolve by lookup, not by assumption.
- [ ] Tenancy resolved server-side; no client-supplied `merchant_id` trusted.
- [ ] Webhook signature verified against raw bytes before parsing.
- [ ] Secrets absent from logs, responses, and client bundles.
- [ ] Terminal states remain distinct (`INCOMPLETE`, `EXPIRED`, `CANCELED` not
      collapsed).

## 4. Definition of done

Per [Standard 06 §4](../../docs/standards/06-roadmap-documentation-governance.md#4-standard-definition-of-done),
verify each gate that the change engages: Architecture, Lifecycle, Idempotency,
Financial, Security, Recovery, UI, Operations, Documentation.

Specifically check that:

- tests cover the failure and duplicate paths, not only the happy path;
- documentation whose contract moved was updated in the same change;
- no unrelated cleanup rode along.

## 5. Report findings, ranked

For each finding give the file, line, the specific clause or invariant violated,
and a concrete failure scenario — inputs or state leading to a wrong outcome. A
finding without a failure scenario is a preference, and should be labelled as one.

Separate:

- **Violations** of a standard or invariant.
- **Divergences** between code and a document, where which side is wrong is a
  decision for the owner. Do not resolve these unilaterally; check the divergence
  register in [`docs/standards/README.md`](../../docs/standards/README.md) first
  to avoid re-reporting a known one.
- **Preferences**, clearly labelled as such.

Then disclose the governance files you loaded, as required by `AGENTS.md` §7.
