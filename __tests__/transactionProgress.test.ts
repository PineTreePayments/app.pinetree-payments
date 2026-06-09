import fs from "fs"
import path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn(),
  updateTransactionStatus: vi.fn()
}))

import {
  getTransactionByPaymentId,
  updateTransactionStatus
} from "@/database/transactions"
import { syncTransactionProgressForPayment } from "@/engine/transactionProgress"

const mockGetTransaction = vi.mocked(getTransactionByPaymentId)
const mockUpdateTransaction = vi.mocked(updateTransactionStatus)

function transaction(status: "PENDING" | "PROCESSING" | "CONFIRMED" | "FAILED" | "INCOMPLETE") {
  return {
    id: "tx-1",
    payment_id: "pay-1",
    merchant_id: "merchant-1",
    provider: "test",
    status,
    created_at: "2026-06-08T00:00:00.000Z"
  }
}

describe("nonterminal transaction progress", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("advances a PENDING transaction to PROCESSING", async () => {
    mockGetTransaction.mockResolvedValue(transaction("PENDING"))

    const result = await syncTransactionProgressForPayment("pay-1", "PROCESSING")

    expect(result).toMatchObject({ skipped: false, newStatus: "PROCESSING" })
    expect(mockUpdateTransaction).toHaveBeenCalledWith("tx-1", "PROCESSING")
  })

  it("is idempotent when transaction progress is already in sync", async () => {
    mockGetTransaction.mockResolvedValue(transaction("PROCESSING"))

    const result = await syncTransactionProgressForPayment("pay-1", "PROCESSING")

    expect(result).toMatchObject({ skipped: true, skipReason: "already_in_sync" })
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  it("never overwrites a terminal transaction", async () => {
    mockGetTransaction.mockResolvedValue(transaction("CONFIRMED"))

    const result = await syncTransactionProgressForPayment("pay-1", "PROCESSING")

    expect(result).toMatchObject({
      skipped: true,
      skipReason: "terminal_transaction_not_overwritten"
    })
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  it("keeps terminal sync in reconciliation and direct progress writes in one helper", () => {
    const eventProcessor = fs.readFileSync(
      path.join(process.cwd(), "engine/eventProcessor.ts"),
      "utf8"
    )
    const updatePaymentStatus = fs.readFileSync(
      path.join(process.cwd(), "engine/updatePaymentStatus.ts"),
      "utf8"
    )

    expect(eventProcessor).not.toContain("updateTransactionStatus(")
    expect(eventProcessor).toContain("syncTransactionProgressForPayment")
    expect(updatePaymentStatus).toContain("reconcileTransactionForPayment")
  })

  it("updates only transaction columns present in the production schema", () => {
    const transactionsSource = fs.readFileSync(
      path.join(process.cwd(), "database/transactions.ts"),
      "utf8"
    )
    const updateStart = transactionsSource.indexOf(
      "export async function updateTransactionStatus"
    )
    const updateEnd = transactionsSource.indexOf(
      "export async function updateTransactionProviderReference"
    )
    const updateSource = transactionsSource.slice(updateStart, updateEnd)

    expect(updateSource).toContain(".update({ status })")
    expect(updateSource).not.toContain("updated_at")
  })
})
