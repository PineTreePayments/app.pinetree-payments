import { describe, expect, it } from "vitest"
import { normalizePaymentCorrelationId } from "@/lib/payment/paymentCorrelation"

describe("payment correlation IDs", () => {
  it("accepts the checkout attempt ID character set", () => {
    expect(normalizePaymentCorrelationId("pay_123:attempt-456.7")).toBe("pay_123:attempt-456.7")
  })

  it.each(["", "contains spaces", "line\nbreak", "x".repeat(129)])(
    "rejects unsafe correlation value %j",
    (value) => expect(normalizePaymentCorrelationId(value)).toBeUndefined()
  )
})
