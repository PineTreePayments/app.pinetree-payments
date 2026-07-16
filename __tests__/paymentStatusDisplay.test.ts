import { describe, expect, it } from "vitest"

import { normalizeReportStatus } from "@/engine/reportDisplayNormalization"
import {
  getPaymentDisplayStatus,
  getPaymentStatusLabel,
} from "@/lib/utils/paymentStatus"

describe("shared payment status display", () => {
  it.each([
    ["CREATED",    "Waiting",    "waiting",    "clock"],
    ["PENDING",    "Waiting",    "waiting",    "clock"],
    ["PROCESSING", "Processing", "processing", "spinner"],
    ["CONFIRMED",  "Confirmed",  "confirmed",  "check-circle"],
    ["FAILED",     "Failed",     "failed",     "x-circle"],
    ["INCOMPLETE", "Canceled",   "canceled",   "x-circle"],
    ["EXPIRED",    "Expired",    "expired",    "x-circle"],
    ["CANCELED",   "Canceled",   "canceled",   "x-circle"],
    ["REFUNDED",   "Refunded",   "refunded",   "refund"],
    ["DISPUTED",   "Disputed",   "disputed",   "alert-triangle"],
    ["UNKNOWN",    "Unknown",    "unknown",    "minus"],
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
    ["completed", "Confirmed"],
    ["declined",  "Failed"],
    ["rejected",  "Failed"],
    ["cancelled", "Canceled"],
    ["abandoned", "Canceled"],
    ["timed out", "Expired"],
  ])("normalizes provider wording %s without changing stored state", (status, label) => {
    const display = getPaymentDisplayStatus(status)
    expect(display.label).toBe(label)
    expect(display.status).toBe(status.toUpperCase().replace(/[\s-]+/g, "_"))
  })

  it("does not leak unknown provider wording", () => {
    expect(getPaymentStatusLabel("SOME_FUTURE_PROVIDER_STATE")).toBe("Unknown")
  })

  it("keeps display normalization independent of record age", () => {
    expect(normalizeReportStatus("PENDING",    "2020-01-01T00:00:00Z")).toBe("Waiting")
    expect(normalizeReportStatus("CONFIRMED",  "2020-01-01T00:00:00Z")).toBe("Confirmed")
  })

  it("accepts only a status argument", () => {
    expect(getPaymentDisplayStatus.length).toBe(1)
  })

  it("CONFIRMED displays as Confirmed, not Success", () => {
    expect(getPaymentStatusLabel("CONFIRMED")).toBe("Confirmed")
    expect(getPaymentStatusLabel("CONFIRMED")).not.toBe("Success")
  })

  it("Waiting uses blue classes, not gray", () => {
    const display = getPaymentDisplayStatus("PENDING")
    expect(display.classes).toContain("blue")
    expect(display.classes).not.toContain("gray")
    expect(display.tone).toBe("waiting")
  })

  it("Processing uses blue classes, not purple", () => {
    const display = getPaymentDisplayStatus("PROCESSING")
    expect(display.classes).toContain("blue")
    expect(display.classes).not.toContain("purple")
    expect(display.classes).not.toContain("violet")
    expect(display.tone).toBe("processing")
    expect(display.classes).not.toBe(getPaymentDisplayStatus("PENDING").classes)
  })

  it("Confirmed uses green classes", () => {
    const display = getPaymentDisplayStatus("CONFIRMED")
    expect(display.classes).toContain("green")
    expect(display.tone).toBe("confirmed")
  })

  it("Failed uses red classes", () => {
    const display = getPaymentDisplayStatus("FAILED")
    expect(display.classes).toContain("red")
    expect(display.tone).toBe("failed")
  })

  it("Incomplete is an internal alias for merchant-facing Canceled", () => {
    const display = getPaymentDisplayStatus("INCOMPLETE")
    expect(display.label).toBe("Canceled")
    expect(display.classes).toContain("gray")
    expect(display.classes).not.toContain("amber")
    expect(display.tone).toBe("canceled")
  })

  it("Expired uses red classes, not amber or gray", () => {
    const display = getPaymentDisplayStatus("EXPIRED")
    expect(display.classes).toContain("red")
    expect(display.classes).not.toContain("amber")
    expect(display.classes).not.toContain("gray")
    expect(display.tone).toBe("expired")
  })

  it("uses dedicated refund and future dispute colors", () => {
    expect(getPaymentDisplayStatus("REFUNDED").classes).toContain("orange")
    expect(getPaymentDisplayStatus("DISPUTED").classes).toContain("amber")
  })

  it("Expired and Failed remain distinct from canceled abandonment", () => {
    const incomplete = getPaymentDisplayStatus("INCOMPLETE")
    const expired    = getPaymentDisplayStatus("EXPIRED")
    const failed     = getPaymentDisplayStatus("FAILED")

    expect(incomplete.classes).toContain("gray")
    expect(expired.classes).toContain("red")
    expect(failed.classes).toContain("red")

    expect(incomplete.label).toBe("Canceled")
    expect(expired.label).toBe("Expired")
    expect(failed.label).toBe("Failed")
  })

  it("Incomplete and Expired have distinct merchant outcomes", () => {
    expect(getPaymentStatusLabel("INCOMPLETE")).toBe("Canceled")
    expect(getPaymentStatusLabel("EXPIRED")).toBe("Expired")
  })
})
