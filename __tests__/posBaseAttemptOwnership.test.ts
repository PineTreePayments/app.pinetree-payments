import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for the Base POS cross-intent ownership fix.
 *
 * Production evidence showed a new POS intent (32a2cfe2...) and an old,
 * already-abandoned intent (6146158c...) polling simultaneously, with the
 * old intent's Base attempt never being torn down: it kept its WalletConnect
 * session alive, could still run eth_getLogs fallback scanning, and could
 * still write UI-visible state.
 *
 * Root cause: components/pos/POSLayout.tsx's supersession guard
 * (isCurrentBasePayment) only ever re-reads the *same* intent's own DB row.
 * A stale attempt that belonged to an intent the POS terminal has since
 * abandoned has no way to discover that — that intent's row is left
 * untouched and keeps reporting itself as "current" forever. This gap is
 * present byte-identical at the c7d9e6a baseline too, so restoring baseline
 * does not fix it; a new client-side attempt-ownership token was added
 * instead (posBaseAttemptRef), per explicit authorization to use "an
 * attempt token/ref" without adding server-side/DB infrastructure.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("POSLayout Base attempt ownership", () => {
  const src = read("components/pos/POSLayout.tsx")

  it("declares a bump-able attempt token distinct from the running guard", () => {
    expect(src).toContain("const posBaseAttemptRef = useRef(0)")
    expect(src).toContain("function isOwnedBaseAttempt(myAttempt: number): boolean")
    expect(src).toContain("return posBaseAttemptRef.current === myAttempt")
  })

  it("resetSale() invalidates the current attempt before tearing down the WC session", () => {
    const start = src.indexOf("function resetSale()")
    const end = src.indexOf("\n  }", start)
    const block = src.slice(start, end)
    expect(block).toContain("posBaseAttemptRef.current += 1")
    expect(block).toContain("posBaseRunningRef.current = false")
    expect(block).toContain("posWcProviderRef.current.disconnect()")
    // The invalidation must happen before the guard is checked elsewhere -
    // simple ordering sanity: it appears before the provider teardown.
    expect(block.indexOf("posBaseAttemptRef.current += 1")).toBeLessThan(
      block.indexOf("posWcProviderRef.current.disconnect()")
    )
  })

  it("a new intentId mount invalidates any in-flight attempt and releases the running guard", () => {
    const effectStart = src.indexOf("// Detect when the customer selects Base on the hosted checkout.")
    const effectEnd = src.indexOf("}, [intentId])", effectStart)
    const block = src.slice(effectStart, effectEnd)
    expect(block).toContain("posBaseAttemptRef.current += 1")
    expect(block).toContain("posBaseRunningRef.current = false")
    // Must invalidate before the poll loop is defined/started.
    expect(block.indexOf("posBaseAttemptRef.current += 1")).toBeLessThan(block.indexOf("const poll ="))
  })

  it("runPosBaseFlow accepts and threads an attempt token through its signature", () => {
    const sigStart = src.indexOf("async function runPosBaseFlow(")
    const sigEnd = src.indexOf("): Promise<void> {", sigStart)
    const signature = src.slice(sigStart, sigEnd)
    expect(signature).toContain("myAttempt: number")
    expect(src).toContain("void runPosBaseFlow(pid, intentId, asset, paymentUrl, myAttempt)")
  })

  it("both post-wait supersession checks also check local attempt ownership, not just the DB row", () => {
    const occurrences = src.split("isOwnedBaseAttempt(myAttempt) || !(await isCurrentBasePayment(iid, paymentId))")
    expect(occurrences.length - 1).toBe(2)
  })

  it("the superseded-payment watcher rejects on local attempt invalidation without waiting on a network round trip", () => {
    const start = src.indexOf("function createBasePaymentSupersededWatcher(")
    const end = src.indexOf("\n  }\n\n  async function runPosBaseFlow", start)
    const block = src.slice(start, end)
    expect(block).toContain("if (!isOwnedBaseAttempt(myAttempt)) {")
    expect(block).toContain('reject(new Error("Base payment attempt abandoned"))')
  })

  it("a stale (superseded) attempt cannot clobber the current sale's UI state on failure", () => {
    const start = src.indexOf("// A superseded attempt's failure belongs to whatever sale it was for")
    const end = src.indexOf("} finally {", start)
    const block = src.slice(start, end)
    expect(block).toContain("if (isOwnedBaseAttempt(myAttempt)) {")
    expect(block).toContain("setPaymentError(message)")
    expect(block).toContain('setStatus("failed")')
    expect(block).toContain("stale_attempt_error_suppressed")
    // Ownership is checked before each UI-visible mutation, not once.
    expect(block.split("isOwnedBaseAttempt(myAttempt)").length - 1).toBeGreaterThanOrEqual(2)
  })

  it("a stale attempt always disconnects the WalletConnect session it created, even without ownership", () => {
    const anchor = src.indexOf("stale_attempt_error_suppressed")
    const start = src.indexOf("} finally {", anchor)
    const end = src.indexOf("\n  }\n\n  // Detect when the customer selects Base", start)
    const block = src.slice(start, end)
    expect(block).toContain("flow_owner_released")
    expect(block).toContain("if (localProvider) {")
    expect(block).toContain("localProvider.disconnect()")
    // Shared refs are only cleared when this attempt still owns them, so a
    // newer attempt's own provider/guard is never clobbered by a stale one.
    expect(block).toContain("if (isOwnedBaseAttempt(myAttempt)) {")
    expect(block).toContain("posBaseRunningRef.current = false")
  })

  it("localProvider is captured from the local closure, not the shared ref, so it survives being superseded", () => {
    expect(src).toContain("let localProvider: PosWcProvider | null = null")
    expect(src).toContain("localProvider = wcResult.provider")
  })

  it("polling/status-check code paths never call runPosBaseFlow", () => {
    // The only call site for runPosBaseFlow must be the one inside the Base
    // rail-selection poll loop - confirming/status polling (the "POLLING
    // FALLBACK" effect and realtime handlers) must never invoke it.
    const callSites = src.split("runPosBaseFlow(").length - 1
    // One in the function declaration itself, one in the call site.
    expect(callSites).toBe(2)
  })

  it("no txHash means no /detect call — the only /detect fetch requires the locally-assigned txHash variable", () => {
    const detectCallStart = src.indexOf('await fetch(`/api/payments/${encodeURIComponent(paymentId)}/detect`')
    const block = src.slice(detectCallStart, detectCallStart + 300)
    expect(block).toContain("JSON.stringify({ txHash })")
    // txHash is declared just once in this function and only assigned after
    // a successful wallet response - there is no path to this fetch call
    // without it.
    expect(src).toContain("let txHash: string")
  })
})
