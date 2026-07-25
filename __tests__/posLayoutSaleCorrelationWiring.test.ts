import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Structural coverage proving components/pos/POSLayout.tsx actually wires
 * the sale-generation/intentId/paymentId correlation (behaviorally covered
 * in posSaleCorrelationGuard.test.ts) into every pathway that can update
 * the POS screen: polling, both realtime subscriptions, and resetSale()'s
 * invalidation of all three.
 *
 * Follows this file's existing convention (see posBaseAttemptOwnership.test.ts,
 * posBaseDuplicateFlowWiring.test.ts) of asserting against the component's
 * source rather than rendering it — no @testing-library/react or jsdom is
 * configured in this project (vitest.config.ts's environment: "node").
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("POSLayout — sale correlation wiring", () => {
  const src = read("components/pos/POSLayout.tsx")

  it("declares a generation counter and an intentId ref, kept in sync with state", () => {
    expect(src).toContain("const saleGenerationRef = useRef(0)")
    expect(src).toContain("const intentIdRef = useRef(\"\")")
    expect(src).toContain("intentIdRef.current = intentId")
  })

  it("resetSale() bumps the generation before touching any other state — invalidating every pathway from the sale being torn down", () => {
    const start = src.indexOf("function resetSale()")
    const end = src.indexOf("\n  }\n\n  async function cancelSale", start)
    const block = src.slice(start, end)
    expect(block).toContain("saleGenerationRef.current += 1")
    // Must happen before the state clears (setIntentId(""), setActivePaymentId("")),
    // not after — an async callback racing the reset must see the bump.
    expect(block.indexOf("saleGenerationRef.current += 1")).toBeLessThan(
      block.indexOf('setIntentId("")')
    )
  })

  it("every applyPaymentStatus call site passes a generation captured at listener/request setup time, not read fresh per event", () => {
    const callSites = [...src.matchAll(/applyPaymentStatus\(/g)]
    // 1 definition + 3 real call sites (poll, realtime direct payment, realtime intent-resolved payment).
    expect(callSites.length).toBe(4)
    expect(src).toContain("generation: myGeneration")
  })

  it("the poll loop captures myGeneration once at effect setup (outside the interval tick) and checks it before EVER reading the response body", () => {
    const effectStart = src.indexOf("POLLING FALLBACK")
    const effectEnd = src.indexOf("REALTIME: DIRECT PAYMENT", effectStart)
    const block = src.slice(effectStart, effectEnd)
    expect(block).toContain("const myGeneration = saleGenerationRef.current")
    const setupIndex = block.indexOf("const myGeneration = saleGenerationRef.current")
    const intervalIndex = block.indexOf("setInterval(async () => {")
    expect(setupIndex).toBeLessThan(intervalIndex)

    const preReadCheckIndex = block.indexOf("evaluatePosSaleUpdate(")
    const jsonReadIndex = block.indexOf("await res.json()")
    expect(preReadCheckIndex).toBeGreaterThan(-1)
    expect(preReadCheckIndex).toBeLessThan(jsonReadIndex)
  })

  it("the poll effect's cleanup clears the interval — starting a new sale (which changes activePaymentId/intentId) stops it", () => {
    const effectStart = src.indexOf("POLLING FALLBACK")
    const effectEnd = src.indexOf("REALTIME: DIRECT PAYMENT", effectStart)
    const block = src.slice(effectStart, effectEnd)
    expect(block).toContain("return () => clearInterval(interval)")
  })

  it("the direct-payment realtime effect captures myGeneration/myPaymentId at subscribe time and unsubscribes on cleanup", () => {
    const effectStart = src.indexOf("REALTIME: DIRECT PAYMENT")
    const effectEnd = src.indexOf("REALTIME: INTENT FLOW", effectStart)
    const block = src.slice(effectStart, effectEnd)
    expect(block).toContain("const myGeneration = saleGenerationRef.current")
    expect(block).toContain("const myPaymentId = activePaymentId")
    expect(block).toContain("return () => { supabase.removeChannel(channel) }")
    expect(block).toContain('source: "realtime_direct_payment"')
  })

  it("the intent-flow realtime effect captures myGeneration/myIntentId once, shares it with the payment channel it later resolves to, and unsubscribes both channels on cleanup", () => {
    const effectStart = src.indexOf("REALTIME: INTENT FLOW")
    const effectEnd = src.indexOf("POLLING FALLBACK 2", effectStart) // no such marker; bound generously
    const block = src.slice(effectStart, effectStart + 3500)
    expect(block).toContain("const myGeneration = saleGenerationRef.current")
    expect(block).toContain("const myIntentId = intentId")
    expect(block).toContain('source: "realtime_intent_resolved_payment"')
    expect(block).toContain("supabase.removeChannel(intentChannel)")
    expect(block).toContain("if (paymentChannel) supabase.removeChannel(paymentChannel)")
  })

  it("subscribeToPayment rejects a stale intent-link (its own generation check) before ever touching activePaymentId", () => {
    const start = src.indexOf("function subscribeToPayment(pid: string) {")
    const end = src.indexOf("resolvedPaymentIdRef.current = pid", start)
    const block = src.slice(start, end)
    expect(block).toContain("evaluatePosSaleUpdate(")
    expect(block).toContain("status: \"intent_link_discarded\"")
    expect(block).toContain("if (linkCheck.stale)")
  })

  it("a correctly-correlated update (same generation, matching IDs) still reaches setStatus — the guard only blocks, never replaces, normal completion", () => {
    const fnStart = src.indexOf("function applyPaymentStatus(")
    const fnEnd = src.indexOf("\n  }\n\n  useEffect(() => {\n    return () => {\n      if (resetTimerRef", fnStart)
    const block = src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2500)
    expect(block).toContain("if (result.stale) {")
    expect(block).toContain("logStalePosSaleUpdate(result)")
    expect(block).toContain("return")
    expect(block).toContain("setStatus(next)")
    // setStatus must be reachable only after the stale-check's own early return,
    // not before it.
    expect(block.indexOf("if (result.stale)")).toBeLessThan(block.indexOf("setStatus(next)"))
  })
})
