import { describe, expect, it } from "vitest"
import { normalizeOverviewChartData } from "@/lib/dashboardChartData"

const now = new Date("2026-06-21T12:00:00Z")

describe("normalizeOverviewChartData", () => {
  it("returns an empty state with every day represented when there are no payments", () => {
    const result = normalizeOverviewChartData([], "7D", now)

    expect(result.isEmpty).toBe(true)
    expect(result.activeDayCount).toBe(0)
    expect(result.points).toHaveLength(7)
    expect(result.points[0]).toMatchObject({ date: "2026-06-15", volume: 0 })
    expect(result.points[6]).toMatchObject({ date: "2026-06-21", volume: 0 })
  })

  it("counts a single active payment day without collapsing missing days", () => {
    const result = normalizeOverviewChartData(
      [{ date: "2026-06-18", volume: 20 }],
      "7D",
      now
    )

    expect(result.isEmpty).toBe(false)
    expect(result.activeDayCount).toBe(1)
    expect(result.points).toHaveLength(7)
    expect(result.points.find((point) => point.date === "2026-06-18")?.volume).toBe(20)
  })

  it("returns multiple active days and sums same-day volume", () => {
    const result = normalizeOverviewChartData(
      [
        { date: "2026-06-16", volume: 20 },
        { date: "2026-06-16", volume: 5 },
        { date: "2026-06-20", volume: 40 }
      ],
      "7D",
      now
    )

    expect(result.activeDayCount).toBe(2)
    expect(result.points.find((point) => point.date === "2026-06-16")?.volume).toBe(25)
    expect(result.points.find((point) => point.date === "2026-06-20")?.volume).toBe(40)
  })

  it("includes missing days and pads the y-axis maximum", () => {
    const result = normalizeOverviewChartData(
      [{ date: "2026-06-21", volume: 100 }],
      "7D",
      now
    )

    expect(result.points.map((point) => point.date)).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21"
    ])
    expect(result.maxValue).toBeGreaterThan(100)
  })
})
