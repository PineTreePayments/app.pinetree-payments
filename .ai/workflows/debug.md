# Workflow — Debug

Diagnosing a defect. Read after the preflight output, alongside
[`AGENTS.md`](../../AGENTS.md).

## 1. Establish the canonical expectation first

Before theorizing, learn what the system is *supposed* to do:

- The payment/withdrawal state machine and allowed transitions —
  [Standard 02](../../docs/standards/02-lifecycle-and-merchant-status.md).
- The minimum confirmation evidence for the affected rail —
  [Standard 05 §6](../../docs/standards/05-provider-connectors-events.md#6-rail-specific-confirmation-evidence).
  This table is the fastest way to decide whether a payment *should* have
  confirmed.
- Whether the symptom is a known open divergence — the divergence register in
  [`docs/standards/README.md`](../../docs/standards/README.md).

A "bug" that is actually the standard being enforced is a valuable finding. Say
so instead of changing the code.

## 2. Get evidence before forming a theory

Preferred order:

1. **Provider or network truth** — the provider object, the receipt, the
   signature, the on-chain status. This is the outer authority.
2. **Canonical rows** — the payment row, its event history, ledger links.
3. **Server logs** with correlation IDs.
4. **Client logs** last. Client state is the least authoritative and the most
   likely to be stale.

State plainly which of these you could and could not obtain. If you cannot
observe a live wallet, a device, or a hosted database from this environment, say
that rather than inferring the result.

## 3. Classify the failure

| Symptom | First hypothesis |
|---|---|
| Stuck non-terminal (Waiting/Processing forever) | Confirmation evidence never reached the Engine — missed webhook, watcher not emitting, recovery path not running |
| False terminal (Failed/Incomplete on a real payment) | A client-side or timeout signal was treated as authoritative evidence |
| False success | A client action, approval, or wallet return was treated as confirmation |
| Duplicated fee or balance | Non-deterministic idempotency/posting key, or a non-transactional post |
| Wrong merchant label | Provider vocabulary leaked past the adapter boundary, or a surface bypassed the shared presentation contract |
| Timeout treated as failure | UNKNOWN outcome not resolved by a lookup |

## 4. Locate the owning layer

Trace along `Interface -> API -> Engine -> Provider Adapter -> External Rail` and
find the layer that *should* own the decision. The defect is very often that a
decision was made in the wrong layer — a webhook writing status, UI inferring
success, an adapter mutating a row.

Read the actual current implementation. Do not rely on a document to tell you
what the code does; documents state what it *should* do. When they disagree, that
is a reportable conflict, not a licence to pick one.

## 5. Fix at the root, minimally

- Repair the layer that owns the decision, not the surface that displayed it.
- Do not add a compensating guard downstream of a wrong decision upstream.
- Keep the change scoped to the diagnosed cause. Adjacent hardening you did not
  diagnose is out of scope — note it instead.
- If the correct fix would change a canonical transition, a fee posting, or
  accounting history, stop and report before implementing.

## 6. Prove it

- Add a regression test that fails before the fix and passes after.
- Cover the duplicate-event and out-of-order paths if the defect touched event
  processing.

```bash
npm run typecheck
npm run lint
npm test
```

Report pre-existing failures as pre-existing. Then disclose the governance files
you loaded, as required by `AGENTS.md` §7.
