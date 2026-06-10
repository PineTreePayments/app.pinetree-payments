import { describe, expect, it } from "vitest"

import { normalizeReportStatus } from "@/engine/reportDisplayNormalization"
import {
  getPaymentDisplayStatus,
  getPaymentStatusLabel,
} from "@/lib/utils/paymentStatus"

describe("shared payment status display", () => {
  it.each([
    ["CREATED", "Waiting", "waiting", "clock"],
    ["PENDING", "Waiting", "waiting", "clock"],
    ["PROCESSING", "Processing", "processing", "spinner"],
    ["CONFIRMED", "Success", "success", "check-circle"],
    ["FAILED", "Failed", "failed", "x-circle"],
    ["INCOMPLETE", "Incomplete", "incomplete", "minus"],
    ["EXPIRED", "Expired", "expired", "clock"],
  ])("%s displays as %s", (status, label, tone, icon) => {
    const display = getPaymentDisplayStatus(status)

    expect(display.status).toBe(status)
    expect(display.label).toBe(label)
    expect(display.tone).toBe(tone)
    expect(display.icon).toBe(icon)
  })

  it("uses the processing animation only for Processing", () => {
    expect(getPaymentDisplayStatus("PROCESSING").spin).toBe(true)
    expect(getPaymentDisplayStatus("PENDING").spin).toBeUndefined()
  })

  it.each([
    ["completed", "Success"],
    ["declined", "Failed"],
    ["rejected", "Failed"],
    ["cancelled", "Incomplete"],
    ["abandoned", "Incomplete"],
    ["timed out", "Expired"],
  ])("normalizes provider wording %s without changing stored state", (status, label) => {
    const display = getPaymentDisplayStatus(status)
    expect(display.label).toBe(label)
    expect(display.status).toBe(status.toUpperCase().replace(/[\s-]+/g, "_"))
  })

  it("does not leak unknown provider wording", () => {
    expect(getPaymentStatusLabel("SOME_FUTURE_PROVIDER_STATE")).toBe("Waiting")
  })

  it("keeps display normalization independent of record age", () => {
    expect(normalizeReportStatus("PENDING", "2020-01-01T00:00:00Z")).toBe("Waiting")
    expect(normalizeReportStatus("CONFIRMED", "2020-01-01T00:00:00Z")).toBe("Success")
  })

  it("accepts only a status argument", () => {
    expect(getPaymentDisplayStatus.length).toBe(1)
  })
})
