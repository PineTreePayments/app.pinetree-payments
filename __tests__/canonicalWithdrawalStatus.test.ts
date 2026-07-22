import { describe, expect, it } from "vitest"
import {
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
