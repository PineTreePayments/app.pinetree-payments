import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Structural coverage proving components/pos/POSLayout.tsx actually wires
 * PosBaseDuplicateGuard (lib/pos/posBaseDuplicateGuard.ts, covered
 * behaviorally in posBaseDuplicateGuard.test.ts) into every point the
 * production incident's duplicate restart passed through: the poll loop,
 * runPosBaseFlow's own entry/exit, and resetSale()/cancelSale().
 *
 * Follows this file's existing convention (see posBaseAttemptOwnership.test.ts)
 * of asserting against the component's source rather than rendering the full
 * POS terminal component, which has too many providers/hooks to mount cheaply
 * in this suite.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("POSLayout — duplicate Base flow suppression wiring", () => {
  const src = read("components/pos/POSLayout.tsx")

  it("imports and instantiates exactly one PosBaseDuplicateGuard per component instance", () => {
    expect(src).toContain(
      'import { PosBaseDuplicateGuard, type PosBaseFlowGateResult } from "@/lib/pos/posBaseDuplicateGuard"'
    )
    expect(src).toContain("const posBaseDuplicateGuardRef = useRef<PosBaseDuplicateGuard | null>(null)")
    expect(src).toContain("posBaseDuplicateGuardRef.current = new PosBaseDuplicateGuard()")
  })

  it("runPosBaseFlow checks the gate before flow_owner_acquired and before any WalletConnect work", () => {
    const fnStart = src.indexOf("async function runPosBaseFlow(")
    const gateIndex = src.indexOf("const gate = await isBaseFlowStartBlocked(iid, paymentId, myAttempt)", fnStart)
    const ownerAcquiredIndex = src.indexOf('console.log("[POS Base WC] flow_owner_acquired"', fnStart)
    const wcInitIndex = src.indexOf("await initPosBaseWalletConnect()", fnStart)

    expect(gateIndex).toBeGreaterThan(fnStart)
    expect(gateIndex).toBeLessThan(ownerAcquiredIndex)
    expect(gateIndex).toBeLessThan(wcInitIndex)
  })

  it("a blocked gate returns before flow_owner_acquired ever logs and before any WalletConnect init", () => {
    const gateIndex = src.indexOf("const gate = await isBaseFlowStartBlocked(")
    const block = src.slice(gateIndex, gateIndex + 400)
    expect(block).toContain("if (gate.blocked) {")
    expect(block).toContain("base_flow_start_blocked")
    expect(block).toContain("return")
    // The blocked branch must return before flow_owner_acquired is reachable.
    const returnIndex = block.indexOf("return")
    const ownerAcquiredIndexInBlock = block.indexOf("flow_owner_acquired")
    expect(returnIndex).toBeLessThan(
      ownerAcquiredIndexInBlock === -1 ? Number.POSITIVE_INFINITY : ownerAcquiredIndexInBlock
    )
  })

  it("isBaseFlowStartBlocked reads the two existing endpoints (session mirror + payment status) — no new API route", () => {
    const fnStart = src.indexOf("async function isBaseFlowStartBlocked(")
    const fnEnd = src.indexOf("\n  }\n\n", fnStart)
    const block = src.slice(fnStart, fnEnd)
    expect(block).toContain("/api/pos/base-session/${encodeURIComponent(iid)}")
    expect(block).toContain("/api/payments/status?paymentId=${encodeURIComponent(paymentId)}")
    expect(block).toContain("posBaseDuplicateGuard.evaluateLocalStart(iid, paymentId, attemptId)")
    expect(block).toContain("posBaseDuplicateGuard.evaluateServerState(")
  })

  it("every exit from runPosBaseFlow marks the attempt terminal exactly once, in the finally block", () => {
    const finallyIndex = src.indexOf("This exact attemptId is done")
    expect(finallyIndex).toBeGreaterThan(-1)
    const block = src.slice(finallyIndex, finallyIndex + 500)
    expect(block).toContain("posBaseDuplicateGuard.markTerminal(iid, paymentId, myAttempt)")

    // Only one call site for markTerminal in the whole component — a single
    // choke point every exit path (success, blocked, rejected, errored)
    // passes through, rather than scattered calls that could be missed.
    const markTerminalCallSites = src.split("posBaseDuplicateGuard.markTerminal(").length - 1
    expect(markTerminalCallSites).toBe(1)
  })

  it("the poll loop checks the local gate before starting a new attempt, and never calls runPosBaseFlow when blocked", () => {
    const netCheckIndex = src.indexOf('if (net === "base" && pid && !cancelled && !posBaseRunningRef.current) {')
    const runCallIndex = src.indexOf("void runPosBaseFlow(pid, intentId, asset, paymentUrl, myAttempt)", netCheckIndex)
    const gateCheckIndex = src.indexOf(
      "posBaseDuplicateGuard.evaluateLocalStart(intentId, pid, myAttempt).blocked",
      netCheckIndex
    )
    expect(gateCheckIndex).toBeGreaterThan(netCheckIndex)
    expect(gateCheckIndex).toBeLessThan(runCallIndex)
    expect(src).toContain("base_flow_start_suppressed_locally")
  })

  it("resetSale() sets reset-in-progress before invalidating the attempt token, and clears it at the end", () => {
    const start = src.indexOf("function resetSale()")
    const end = src.indexOf("\n  }\n\n  async function cancelSale", start)
    const block = src.slice(start, end)
    expect(block).toContain("posBaseDuplicateGuard.setResetInProgress(true)")
    expect(block).toContain("posBaseDuplicateGuard.setResetInProgress(false)")
    expect(block.indexOf("posBaseDuplicateGuard.setResetInProgress(true)")).toBeLessThan(
      block.indexOf("posBaseAttemptRef.current += 1")
    )
  })

  it("cancelSale() holds reset-in-progress for the full async window, including before the cancel API call resolves", () => {
    const start = src.indexOf("async function cancelSale()")
    const end = src.indexOf("async function cancelSaleInternal()", start)
    const block = src.slice(start, end)
    expect(block).toContain("posBaseDuplicateGuard.setResetInProgress(true)")
    expect(block).toContain("try {")
    expect(block).toContain("await cancelSaleInternal()")
    expect(block).toContain("finally {")
    expect(block).toContain("posBaseDuplicateGuard.setResetInProgress(false)")
  })

  it("a genuinely new payment intent clears the guard's suppression state — the only place reset() is called", () => {
    const effectStart = src.indexOf("// Detect when the customer selects Base on the hosted checkout.")
    const effectEnd = src.indexOf("}, [intentId])", effectStart)
    const block = src.slice(effectStart, effectEnd)
    expect(block).toContain("posBaseDuplicateGuard.reset()")

    const resetCallSites = src.split("posBaseDuplicateGuard.reset()").length - 1
    expect(resetCallSites).toBe(1)
  })

  it("only one proposal is created per completed payment: runPosBaseFlow still has exactly one call site, and it is only reachable past the gate check", () => {
    const callSites = src.split("runPosBaseFlow(").length - 1
    // One in the function declaration itself, one in the poll loop's call site.
    expect(callSites).toBe(2)
  })
})
