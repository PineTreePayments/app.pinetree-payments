import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  hasTransactionVolume,
  prepareTransactionVolumeData,
  type TransactionVolumeSeries
} from "@/components/dashboard/TransactionVolumeChart"

const series: TransactionVolumeSeries[] = [
  { key: "stripe", label: "Stripe", color: "#635bff" },
  { key: "cash", label: "Cash", color: "#22c55e" }
]

describe("TransactionVolumeChart", () => {
  it("handles zero transactions with the empty state", () => {
    expect(hasTransactionVolume([], series)).toBe(false)
    expect(prepareTransactionVolumeData([], "time")).toEqual([])
  })

  it("turns one transaction bucket into a drawable line without adding a point marker", () => {
    const result = prepareTransactionVolumeData([{ time: "Today", stripe: 20 }], "time")
    expect(result).toHaveLength(2)
    expect(result.map((row) => row.stripe)).toEqual([20, 20])

    const source = fs.readFileSync(
      path.join(process.cwd(), "components/dashboard/TransactionVolumeChart.tsx"),
      "utf8"
    )
    expect(source).toContain("dot={false}")
    expect(source).not.toContain("singleActivePoint")
  })

  it("preserves sparse and normal datasets", () => {
    const sparse = [
      { time: "Mon", cash: 0 },
      { time: "Tue", cash: 12 },
      { time: "Wed", cash: 0 }
    ]
    const normal = [
      { time: "Mon", stripe: 8 },
      { time: "Tue", stripe: 12 }
    ]

    expect(prepareTransactionVolumeData(sparse, "time")).toBe(sparse)
    expect(prepareTransactionVolumeData(normal, "time")).toBe(normal)
    expect(hasTransactionVolume(sparse, series)).toBe(true)
    expect(hasTransactionVolume(normal, series)).toBe(true)
  })

  it("ignores unknown provider keys gracefully", () => {
    expect(hasTransactionVolume([{ time: "Today", unknown_provider: 25 }], series)).toBe(false)
  })

  it("is shared by Overview and Transactions with all requested provider series", () => {
    const overview = fs.readFileSync(path.join(process.cwd(), "app/dashboard/page.tsx"), "utf8")
    const transactions = fs.readFileSync(path.join(process.cwd(), "app/dashboard/transactions/page.tsx"), "utf8")

    expect(overview).toContain("<TransactionVolumeChart")
    expect(transactions).toContain("<TransactionVolumeChart")
    for (const key of ["stripe", "shift4", "fluidpay", "solana", "base", "lightning", "cash"]) {
      expect(transactions).toContain(`key: "${key}"`)
    }
  })
})
