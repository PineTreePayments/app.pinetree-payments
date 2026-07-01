import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = fs.readFileSync(
  path.join(process.cwd(), "database/walletWithdrawalRequests.ts"),
  "utf8"
)

describe("wallet withdrawal activity cleanup", () => {
  it("cleans only stale unsigned review/pending withdrawals", () => {
    expect(source).toContain("cancelStaleUnsignedWithdrawalReviews")
    expect(source).toContain('.in("status", ["review_required", "pending"])')
    expect(source).toContain('.is("tx_hash", null)')
    expect(source).not.toContain('.in("status", ["review_required", "pending", "processing"])')
    expect(source).not.toContain('.in("status", ["review_required", "pending", "confirmed"])')
  })

  it("never cleans processing with tx_hash or confirmed chain history", () => {
    const cleanupStart = source.indexOf("export async function cancelStaleUnsignedWithdrawalReviews")
    const cleanupEnd = source.indexOf("function isMeaningfulActivityWithdrawal")
    const cleanup = source.slice(cleanupStart, cleanupEnd)

    expect(cleanup).not.toContain('"processing"')
    expect(cleanup).not.toContain('"confirmed"')
    expect(cleanup).not.toContain('"failed"')
  })

  it("activity keeps only meaningful withdrawal statuses", () => {
    expect(source).toContain('if (row.status === "processing") return Boolean(row.tx_hash)')
    expect(source).toContain('if (row.status === "confirmed") return true')
    expect(source).toContain('if (row.status === "failed") return Boolean(row.tx_hash)')
    expect(source).toContain('return !row.tx_hash && row.id === activeUnsignedId')
  })
})
