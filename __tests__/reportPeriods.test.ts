import { describe, expect, it } from "vitest"
import {
  DEFAULT_REPORT_TIME_ZONE,
  MAX_CUSTOM_REPORT_DAYS,
  localDateTimeToUtc,
  normalizeTimeZone,
  resolveMerchantReportRange,
} from "@/engine/reportPeriods"

describe("merchant-local report periods", () => {
  it("uses the merchant timezone for today boundaries", () => {
    const range = resolveMerchantReportRange({
      type: "today",
      timeZone: "America/Chicago",
      now: new Date("2026-07-17T15:30:00.000Z"),
    })
    expect(range.startDate).toBe("2026-07-17T05:00:00.000Z")
    expect(range.endDate).toBe("2026-07-17T15:30:00.000Z")
    expect(range.isInProgress).toBe(true)
  })

  it("uses Monday as the consistent weekly boundary", () => {
    const range = resolveMerchantReportRange({
      type: "weekly",
      timeZone: "UTC",
      now: new Date("2026-07-19T12:00:00.000Z"), // Sunday
    })
    expect(range.startDate).toBe("2026-07-13T00:00:00.000Z")
  })

  it("makes custom date-only ranges inclusive in merchant local time", () => {
    const range = resolveMerchantReportRange({
      type: "custom",
      timeZone: "America/Chicago",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      now: new Date("2026-07-17T00:00:00.000Z"),
    })
    expect(range.startDate).toBe("2026-07-01T05:00:00.000Z")
    expect(range.endDate).toBe("2026-07-03T04:59:59.999Z")
    expect(range.isInProgress).toBe(false)
  })

  it("handles daylight-saving offsets at local day boundaries", () => {
    expect(localDateTimeToUtc(
      { year: 2026, month: 3, day: 8 },
      "America/Chicago"
    ).toISOString()).toBe("2026-03-08T06:00:00.000Z")
    expect(localDateTimeToUtc(
      { year: 2026, month: 3, day: 9 },
      "America/Chicago"
    ).toISOString()).toBe("2026-03-09T05:00:00.000Z")
  })

  it("falls back explicitly to UTC for an invalid timezone", () => {
    expect(normalizeTimeZone("not/a-zone")).toBe(DEFAULT_REPORT_TIME_ZONE)
  })

  it("rejects incomplete, reversed, and overly large custom ranges", () => {
    expect(() => resolveMerchantReportRange({ type: "custom", timeZone: "UTC", startDate: "2026-01-01" })).toThrow("Both report start and end dates")
    expect(() => resolveMerchantReportRange({ type: "custom", timeZone: "UTC", startDate: "2026-02-01", endDate: "2026-01-01" })).toThrow("Invalid report date range")
    expect(() => resolveMerchantReportRange({ type: "custom", timeZone: "UTC", startDate: "2025-01-01", endDate: "2026-12-31" })).toThrow(`${MAX_CUSTOM_REPORT_DAYS} days`)
  })

  it("marks invalid custom ranges as client errors", () => {
    try {
      resolveMerchantReportRange({
        type: "custom",
        timeZone: "UTC",
        startDate: "2026-02-01",
        endDate: "2026-01-01",
      })
      throw new Error("expected invalid report range")
    } catch (error) {
      expect(error).toMatchObject({ status: 400 })
    }
  })
})
