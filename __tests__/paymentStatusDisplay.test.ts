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
    ["INCOMPLETE", "Incomplete", "incomplete", "minus"],
    ["EXPIRED",    "Expired",    "expired",    "clock"],
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

  it("Incomplete uses amber classes, not gray", () => {
    const display = getPaymentDisplayStatus("INCOMPLETE")
    expect(display.classes).toContain("amber")
    expect(display.classes).not.toContain("gray")
    expect(display.tone).toBe("incomplete")
  })

  it("Expired uses amber classes, not gray", () => {
    const display = getPaymentDisplayStatus("EXPIRED")
    expect(display.classes).toContain("amber")
    expect(display.classes).not.toContain("gray")
    expect(display.tone).toBe("expired")
  })

  it("no status tone maps payment states to gray classes", () => {
    const statuses = ["CREATED", "PENDING", "PROCESSING", "CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED"]
    for (const status of statuses) {
      const display = getPaymentDisplayStatus(status)
      expect(display.classes, `${status} should not use gray`).not.toContain("gray-1")
      expect(display.classes, `${status} should not use gray`).not.toContain("gray-7")
    }
  })

  it("Incomplete and Expired are visually distinct from Failed", () => {
    const incomplete = getPaymentDisplayStatus("INCOMPLETE")
    const expired    = getPaymentDisplayStatus("EXPIRED")
    const failed     = getPaymentDisplayStatus("FAILED")

    expect(incomplete.classes).not.toContain("red")
    expect(expired.classes).not.toContain("red")
    expect(failed.classes).toContain("red")
  })

  it("Incomplete and Expired share amber but have distinct labels", () => {
    expect(getPaymentStatusLabel("INCOMPLETE")).toBe("Incomplete")
    expect(getPaymentStatusLabel("EXPIRED")).toBe("Expired")
  })
})
