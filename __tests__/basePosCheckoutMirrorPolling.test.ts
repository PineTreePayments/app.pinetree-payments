import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("BasePosCheckoutMirror stops polling on terminal payment status", () => {
  const src = read("components/payment/BasePosCheckoutMirror.tsx")

  it("accepts an optional paymentStatus prop, matching the pattern used by LightningPayment/BaseWalletPayment", () => {
    expect(src).toContain("paymentStatus?: string")
  })

  it("derives a local terminal-status guard from the paymentStatus prop", () => {
    expect(src).toContain(
      'const TERMINAL_PAYMENT_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])'
    )
    expect(src).toContain("const terminalStatus = normalizeTerminalStatus(paymentStatus)")
  })

  it("the polling effect bails out once terminalStatus is set, independent of the parent unmounting it", () => {
    const effectStart = src.indexOf("useEffect(() => {\n    if (!paymentReady) return")
    const effectEnd = src.indexOf("burstUntil, terminalStatus])", effectStart) + "burstUntil, terminalStatus])".length
    const effect = src.slice(effectStart, effectEnd)

    expect(effectStart).toBeGreaterThan(-1)
    expect(effect).toContain("if (terminalStatus) return")
    expect(effect).toContain("terminalStatus")
  })
})

describe("PayClient passes paymentStatus through to BasePosCheckoutMirror", () => {
  it("threads the same normalizedPaymentStatus used by the other payment-method components", () => {
    const src = read("app/pay/PayClient.tsx")
    const mirrorUsage = src.slice(
      src.indexOf("<BasePosCheckoutMirror"),
      src.indexOf("<BasePosCheckoutMirror") + 400
    )
    expect(mirrorUsage).toContain("paymentStatus={normalizedPaymentStatus}")
  })
})
