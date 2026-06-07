import { describe, expect, it } from "vitest"

import { normalizeReportStatus } from "@/engine/reportDisplayNormalization"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"

// ─── 1. One-to-one lifecycle label preservation ────────────────────────────────
//
// Every stored payment status must map to exactly one distinct display label.
// No collapse, no merge, no override based on age or context.

describe("getPaymentDisplayStatus — lifecycle label preservation", () => {
  it.each([
    ["CREATED",    "CREATED",    "Created"],
    ["PENDING",    "PENDING",    "Pending"],
    ["PROCESSING", "PROCESSING", "Processing"],
    ["CONFIRMED",  "CONFIRMED",  "Confirmed"],
    ["FAILED",     "FAILED",     "Failed"],
    ["INCOMPLETE", "INCOMPLETE", "Incomplete"],
    ["EXPIRED",    "EXPIRED",    "Expired"],
    ["CANCELLED",  "CANCELLED",  "Cancelled"],
    ["REFUNDED",   "REFUNDED",   "Refunded"],
  ])("preserves %s as status=%s label=%s", (input, expectedStatus, expectedLabel) => {
    const result = getPaymentDisplayStatus(input)
    expect(result.status).toBe(expectedStatus)
    expect(result.label).toBe(expectedLabel)
  })
})

// ─── 2. Forbidden collapses — no status may become INCOMPLETE ─────────────────
//
// The most common historical violation: PENDING, CREATED, FAILED being
// shown as INCOMPLETE because of age or sweep anticipation.
// These must never happen in the presentation layer.

describe("getPaymentDisplayStatus — forbidden INCOMPLETE collapse", () => {
  it.each([
    "CREATED",
    "PENDING",
    "PROCESSING",
    "FAILED",
    "EXPIRED",
    "CANCELLED",
    "REFUNDED",
  ])("does NOT collapse %s to INCOMPLETE", (status) => {
    const result = getPaymentDisplayStatus(status)
    expect(result.status).not.toBe("INCOMPLETE")
    expect(result.label).not.toBe("Incomplete")
  })
})

// ─── 3. No age/time parameter — function cannot do age-based relabeling ────────
//
// The function signature must accept only `status: string`.
// If it ever accepts a second argument (createdAt), age-based logic
// can re-enter. This test locks the interface.

describe("getPaymentDisplayStatus — no age parameter", () => {
  it("accepts exactly one argument (status only)", () => {
    expect(getPaymentDisplayStatus.length).toBe(1)
  })
})

// ─── 4. normalizeReportStatus — ledger state preservation ─────────────────────
//
// Reports must display the value stored in the database.
// Even when called with an old `createdAt` (simulating a stale record),
// the function must NOT relabel any status.

describe("normalizeReportStatus — ledger state preservation with old dates", () => {
  const STALE_DATE = "2020-01-01T00:00:00Z"

  it.each([
    ["CREATED",    "CREATED"],
    ["PENDING",    "PENDING"],
    ["PROCESSING", "PROCESSING"],
    ["CONFIRMED",  "CONFIRMED"],
    ["FAILED",     "FAILED"],
    ["INCOMPLETE", "INCOMPLETE"],
    ["EXPIRED",    "EXPIRED"],
    ["CANCELLED",  "CANCELLED"],
    ["REFUNDED",   "REFUNDED"],
  ])("preserves %s even for a years-old record", (rawStatus, expected) => {
    expect(normalizeReportStatus(rawStatus, STALE_DATE)).toBe(expected)
  })
})

// ─── 5. Explicit cross-collapse checks ────────────────────────────────────────
//
// Belt-and-suspenders: directly confirm the specific violations
// that occurred historically. If any of these fail, a status mutation
// was reintroduced somewhere in the display stack.

describe("historical regression — specific forbidden relabelings", () => {
  const STALE_DATE = "2020-01-01T00:00:00Z"

  it("old PENDING is not rendered as INCOMPLETE by getPaymentDisplayStatus", () => {
    const result = getPaymentDisplayStatus("PENDING")
    expect(result.status).toBe("PENDING")
    expect(result.label).toBe("Pending")
    expect(result.status).not.toBe("INCOMPLETE")
  })

  it("old CREATED is not rendered as INCOMPLETE by getPaymentDisplayStatus", () => {
    const result = getPaymentDisplayStatus("CREATED")
    expect(result.status).toBe("CREATED")
    expect(result.label).toBe("Created")
    expect(result.status).not.toBe("INCOMPLETE")
  })

  it("FAILED is not rendered as INCOMPLETE by getPaymentDisplayStatus", () => {
    const result = getPaymentDisplayStatus("FAILED")
    expect(result.status).toBe("FAILED")
    expect(result.label).toBe("Failed")
    expect(result.status).not.toBe("INCOMPLETE")
  })

  it("old PENDING is not relabeled INCOMPLETE by normalizeReportStatus", () => {
    expect(normalizeReportStatus("PENDING", STALE_DATE)).toBe("PENDING")
    expect(normalizeReportStatus("PENDING", STALE_DATE)).not.toBe("INCOMPLETE")
  })

  it("old CREATED is not relabeled INCOMPLETE by normalizeReportStatus", () => {
    expect(normalizeReportStatus("CREATED", STALE_DATE)).toBe("CREATED")
    expect(normalizeReportStatus("CREATED", STALE_DATE)).not.toBe("INCOMPLETE")
  })

  it("FAILED is not relabeled INCOMPLETE by normalizeReportStatus", () => {
    expect(normalizeReportStatus("FAILED", STALE_DATE)).toBe("FAILED")
    expect(normalizeReportStatus("FAILED", STALE_DATE)).not.toBe("INCOMPLETE")
  })
})
