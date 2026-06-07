import { describe, expect, it } from "vitest"

import { normalizeReportStatus } from "@/engine/reportDisplayNormalization"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"

describe("payment status display", () => {
  it.each([
    ["CREATED", "Created"],
    ["PENDING", "Pending"],
    ["PROCESSING", "Processing"],
    ["CONFIRMED", "Confirmed"],
    ["FAILED", "Failed"],
    ["INCOMPLETE", "Incomplete"],
    ["EXPIRED", "Expired"],
    ["CANCELLED", "Cancelled"],
    ["REFUNDED", "Refunded"],
  ])("preserves %s as a distinct lifecycle state", (status, label) => {
    expect(getPaymentDisplayStatus(status)).toMatchObject({ status, label })
  })

  it("does not relabel old pending or created records as incomplete", () => {
    expect(normalizeReportStatus("PENDING", "2020-01-01T00:00:00Z")).toBe("PENDING")
    expect(normalizeReportStatus("CREATED", "2020-01-01T00:00:00Z")).toBe("CREATED")
  })
})
