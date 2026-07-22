import { describe, expect, it } from "vitest"
import {
  isAbandonedCreatedWalletOperation,
  mapWalletOperationStatusToActivity,
  mapWalletWithdrawalRequestStatusToActivity,
  mapWalletWithdrawalRequestStatusToMerchantLabel,
} from "@/engine/withdrawals/canonicalWithdrawalStatus"
import type { WalletOperationStatus } from "@/database/merchantWalletOperations"

describe("canonicalWithdrawalStatus", () => {
  describe("mapWalletWithdrawalRequestStatusToActivity (Base/Solana - wallet_withdrawal_requests)", () => {
    it("maps every terminal status to its canonical activity status", () => {
      expect(mapWalletWithdrawalRequestStatusToActivity("confirmed", false)).toBe("confirmed")
      expect(mapWalletWithdrawalRequestStatusToActivity("failed", false)).toBe("failed")
      expect(mapWalletWithdrawalRequestStatusToActivity("canceled", false)).toBe("canceled")
      expect(mapWalletWithdrawalRequestStatusToActivity("blocked", false)).toBe("blocked")
    })

    it("maps processing to sent", () => {
      expect(mapWalletWithdrawalRequestStatusToActivity("processing", true)).toBe("sent")
    })

    it("maps an unrecognized/pending status with a tx_hash to sent (mid-transition safety net)", () => {
      expect(mapWalletWithdrawalRequestStatusToActivity("pending", true)).toBe("sent")
    })

    it("maps pending with no tx_hash to pending", () => {
      expect(mapWalletWithdrawalRequestStatusToActivity("pending", false)).toBe("pending")
      expect(mapWalletWithdrawalRequestStatusToActivity("review_required", false)).toBe("pending")
    })
  })

  describe("mapWalletOperationStatusToActivity (Bitcoin/Speed - merchant_wallet_operations)", () => {
    it("maps every raw WalletOperationStatus to the same canonical vocabulary as the withdrawal-request mapper", () => {
      const cases: Array<[WalletOperationStatus, string]> = [
        ["COMPLETED", "confirmed"],
        ["FAILED", "failed"],
        ["CANCELED", "canceled"],
        ["EXPIRED", "failed"],
        ["PROCESSING", "sent"],
        ["PENDING", "pending"],
        ["CREATED", "pending"],
        ["REQUIRES_ACTION", "pending"],
      ]
      for (const [raw, expected] of cases) {
        expect(mapWalletOperationStatusToActivity(raw)).toBe(expected)
      }
    })

    it("a provider-confirmed Bitcoin operation and a provider-confirmed Base/Solana withdrawal render the identical canonical status", () => {
      // This is the exact invariant behind the production bug this module
      // fixes: a Bitcoin withdrawal confirmed by Speed must never render
      // differently in Activity than a Base/Solana withdrawal confirmed
      // on-chain - both go through one canonical mapper now.
      expect(mapWalletOperationStatusToActivity("COMPLETED")).toBe(
        mapWalletWithdrawalRequestStatusToActivity("confirmed", false)
      )
    })

    it("maps stale evidence-free CREATED wallet operations to incomplete instead of pending", () => {
      const nowMs = new Date("2026-07-22T12:10:00.000Z").getTime()

      expect(isAbandonedCreatedWalletOperation({
        status: "CREATED",
        createdAt: "2026-07-22T12:00:00.000Z",
        updatedAt: "2026-07-22T12:00:00.000Z",
        providerReference: null,
        providerTransactionId: null,
        submittedAt: null,
      }, nowMs)).toBe(true)
      expect(mapWalletOperationStatusToActivity("CREATED", {
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        providerReference: null,
        providerTransactionId: null,
        submittedAt: null,
      })).toBe("incomplete")
    })

    it("keeps fresh or provider-evidenced CREATED wallet operations pending", () => {
      const nowMs = new Date("2026-07-22T12:03:00.000Z").getTime()

      expect(isAbandonedCreatedWalletOperation({
        status: "CREATED",
        createdAt: "2026-07-22T12:00:00.000Z",
        updatedAt: "2026-07-22T12:00:00.000Z",
        providerReference: null,
        providerTransactionId: null,
        submittedAt: null,
      }, nowMs)).toBe(false)
      expect(isAbandonedCreatedWalletOperation({
        status: "CREATED",
        createdAt: "2026-07-22T11:00:00.000Z",
        updatedAt: "2026-07-22T11:00:00.000Z",
        providerReference: "is_123",
        providerTransactionId: null,
        submittedAt: null,
      }, nowMs)).toBe(false)
    })
  })

  describe("mapWalletWithdrawalRequestStatusToMerchantLabel", () => {
    it("maps the three known raw statuses to their display label", () => {
      expect(mapWalletWithdrawalRequestStatusToMerchantLabel("confirmed", "Processing")).toBe("Confirmed")
      expect(mapWalletWithdrawalRequestStatusToMerchantLabel("processing", "Processing")).toBe("Processing")
      expect(mapWalletWithdrawalRequestStatusToMerchantLabel("failed", "Processing")).toBe("Withdrawal failed")
    })

    it("falls back to the caller-supplied label for any other raw status", () => {
      expect(mapWalletWithdrawalRequestStatusToMerchantLabel("pending", "Processing")).toBe("Processing")
    })
  })
})
