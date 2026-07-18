import { describe, expect, it } from "vitest"
import { isTransactionsEmptyPageResult } from "@/engine/transactionsDashboard"

describe("transactions empty-page detection", () => {
  it("accepts the status-only shape returned for an unsatisfiable PostgREST range", () => {
    expect(isTransactionsEmptyPageResult({ status: 416, error: { message: "" } })).toBe(true)
  })

  it("accepts the documented PostgREST error code", () => {
    expect(isTransactionsEmptyPageResult({ status: 400, error: { code: "PGRST103" } })).toBe(true)
  })

  it("does not hide unrelated database errors", () => {
    expect(isTransactionsEmptyPageResult({ status: 500, error: { code: "XX000" } })).toBe(false)
  })
})
