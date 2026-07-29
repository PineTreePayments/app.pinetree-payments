import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

describe("canonical payment presentation boundary", () => {
  it("never accepts a return URL status as terminal lifecycle evidence", () => {
    const checkout = read("app/pay/PayClient.tsx")
    const projection = checkout.slice(
      checkout.indexOf("const normalizedPaymentStatus"),
      checkout.indexOf("const intentCardsRef")
    )

    expect(projection).not.toContain("statusOverride")
    expect(projection).toContain("isTerminalPaymentStatus(normalizedPaymentStatus)")
  })

  it("does not render the POS-mirrored wallet failure as a local FAILED alert", () => {
    const mirror = read("components/payment/BasePosCheckoutMirror.tsx")
    const start = mirror.indexOf('if (step === "failed")')
    const failedBlock = mirror.slice(start, start + 700)

    expect(failedBlock).toContain("<PaymentStatusVisual")
    expect(failedBlock).toContain('status={paymentStatus || "PENDING"}')
    expect(failedBlock).not.toContain("border-red-200")
    expect(failedBlock).not.toContain("Try Again")
    expect(failedBlock).toContain("onAbandon || onCancel")
  })

  it("keeps terminal copy in the shared presentation contract", () => {
    const result = read("components/payment/TransactionResult.tsx")
    expect(result).toContain("<PaymentStatusVisual")
    expect(result).not.toContain("const STATE_CONFIG")
  })
})
