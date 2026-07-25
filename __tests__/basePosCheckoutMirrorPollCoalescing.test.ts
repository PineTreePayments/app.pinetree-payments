import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for the duplicate-GET production symptom: logs showed
 * many simultaneous GET /api/pos/base-session requests at identical
 * timestamps. The steady polling interval, a burst-mode interval, and the
 * visibilitychange/focus/pageshow resume handlers can all trigger
 * pollSession() within the same tick — most commonly when a customer
 * returns from the wallet app, which reliably fires both visibilitychange
 * and focus together. pollSession() now coalesces overlapping callers so
 * only one fetch is in flight at a time.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("BasePosCheckoutMirror pollSession — coalesces overlapping callers", () => {
  const src = read("components/payment/BasePosCheckoutMirror.tsx")

  it("guards pollSession with an in-flight ref so overlapping callers short-circuit instead of firing a duplicate fetch", () => {
    const start = src.indexOf("const pollSession = useCallback(async () => {")
    const end = src.indexOf("}, [intentId])", start)
    const block = src.slice(start, end)

    expect(src).toContain("const pollInFlightRef = useRef(false)")
    expect(block).toContain("if (pollInFlightRef.current) return")
    expect(block).toContain("pollInFlightRef.current = true")
    expect(block).toContain("pollInFlightRef.current = false")
  })

  it("clears the in-flight flag in a finally block so a failed fetch cannot permanently wedge polling", () => {
    const start = src.indexOf("const pollSession = useCallback(async () => {")
    const end = src.indexOf("}, [intentId])", start)
    const block = src.slice(start, end)

    const finallyIndex = block.indexOf("} finally {")
    const flagResetIndex = block.indexOf("pollInFlightRef.current = false")
    expect(finallyIndex).toBeGreaterThan(-1)
    expect(flagResetIndex).toBeGreaterThan(finallyIndex)
  })
})
