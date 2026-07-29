import { describe, expect, it, vi } from "vitest"

const databaseRows = vi.hoisted(() => ([
  { status: "CONFIRMED", gross_amount: 10, pinetree_fee: 0.15 },
  { status: "CANCELED", gross_amount: 20, pinetree_fee: 0.15 },
  { status: "CANCELLED", gross_amount: 30, pinetree_fee: 0.15 },
  { status: "INCOMPLETE", gross_amount: 40, pinetree_fee: 0.15 },
]))

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(async () => ({ data: databaseRows, error: null })),
    })),
  },
  supabase: null,
}))

import {
  getAdminPaymentMetrics,
  PAYMENT_METRICS_DEFAULT,
} from "@/database/adminOverview"

describe("admin overview canceled payment metrics", () => {
  it("computes canonical canceledTransactions from stored rows instead of relying on a UI default", async () => {
    const metrics = await getAdminPaymentMetrics()
    const canceled = (metrics as unknown as { canceledTransactions: number }).canceledTransactions
    const defaultCanceled = (PAYMENT_METRICS_DEFAULT as unknown as { canceledTransactions: number }).canceledTransactions

    expect(canceled).toBe(2)
    expect(defaultCanceled).toBe(0)
    expect(metrics.incompleteTransactions).toBe(1)
    expect(metrics.totalTransactions).toBe(4)
  })
})
