import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Structural coverage proving components/pos/POSLayout.tsx actually wires
 * the generation-scoped post-result reset timer (behaviorally covered in
 * posResultResetTimer.test.ts) into every terminal-result screen — cash,
 * crypto, and the card rail's cardView — rather than each rail/result
 * screen inventing its own timer. Follows this file's existing convention
 * (see posLayoutSaleCorrelationWiring.test.ts) of asserting against the
 * component's source rather than rendering it — no @testing-library/react
 * or jsdom is configured in this project (vitest.config.ts's
 * environment: "node").
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("POSLayout — post-result auto-reset wiring", () => {
  const src = read("components/pos/POSLayout.tsx")

  it("imports the shared reset-timer helpers instead of hand-rolling setTimeout logic", () => {
    expect(src).toContain('from "@/lib/pos/posResultResetTimer"')
    expect(src).toContain("isPosTerminalUiStatus")
    expect(src).toContain("schedulePosResultReset")
    expect(src).toContain("cancelPosResultReset")
  })

  it("the auto-reset effect covers both the non-card terminal statuses and the card rail's approved/declined views", () => {
    const start = src.indexOf("POST-RESULT AUTO-RESET")
    const end = src.indexOf("useEffect(() => {\n    const url = new URL", start)
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, end > start ? end : start + 2000)

    expect(block).toContain('cardView === "approved"')
    expect(block).toContain('cardView === "declined"')
    expect(block).toContain("isPosTerminalUiStatus(status)")
  })

  it("schedules through the central resetSale() function — no separate reset implementation per rail/result screen", () => {
    const start = src.indexOf("POST-RESULT AUTO-RESET")
    const end = src.indexOf("useEffect(() => {\n    const url = new URL", start)
    const block = src.slice(start, end > start ? end : start + 2000)
    expect(block).toContain("schedulePosResultReset(resetTimerRef, myGeneration, () => saleGenerationRef.current, resetSale)")
  })

  it("captures the generation before scheduling, and the effect cleanup cancels the timer — covers manual dismissal, cardView leaving a terminal view (e.g. card 'Try Again'), and unmount", () => {
    const start = src.indexOf("POST-RESULT AUTO-RESET")
    const end = src.indexOf("useEffect(() => {\n    const url = new URL", start)
    const block = src.slice(start, end > start ? end : start + 2000)
    expect(block).toContain("const myGeneration = saleGenerationRef.current")
    expect(block).toContain("cancelPosResultReset(resetTimerRef)")
    // Cleanup must be registered (the effect returns a cleanup function)
    expect(block).toMatch(/return\s*\(\)\s*=>\s*\{[^}]*cancelPosResultReset/)
  })

  it("the effect re-runs whenever status, paymentMode, or cardView changes — not just status alone", () => {
    const start = src.indexOf("POST-RESULT AUTO-RESET")
    const end = src.indexOf("useEffect(() => {\n    const url = new URL", start)
    const block = src.slice(start, end > start ? end : start + 2000)
    expect(block).toContain("[status, paymentMode, cardView]")
  })

  it("every manual dismissal button on a terminal result screen calls the same central resetSale (directly, or onDone which is resetSale)", () => {
    // Non-card terminal screens (INCOMPLETE/FAILED/EXPIRED/CANCELLED) call resetSale directly.
    const nonCardTerminalSection = src.slice(src.indexOf('{/* -- INCOMPLETE -- */}'), src.indexOf('{/* -- CANCELLED -- */}') + 500)
    const resetSaleCallCount = [...nonCardTerminalSection.matchAll(/onClick(?::|=\{)\s*resetSale/g)].length
    expect(resetSaleCallCount).toBeGreaterThanOrEqual(3)

    // Card rail's "New Sale" action is wired directly to resetSale.
    expect(src).toContain("onDone={resetSale}")
  })
})
