/**
 * Single canonical status vocabulary for PineTree Wallet Activity, shared by
 * both withdrawal ledgers (wallet_withdrawal_requests for Base/Solana,
 * merchant_wallet_operations for Bitcoin/Speed). Before this module existed,
 * engine/pineTreeWalletSync.ts maintained two independently-authored inline
 * mapping tables - one per source table - which is exactly the kind of
 * per-surface status decision that lets the same underlying withdrawal
 * render differently depending on which code path touched it last. Every
 * caller that needs to turn a raw DB status into what a merchant sees must
 * go through here, not re-derive its own mapping.
 */

import type { WalletOperationStatus } from "@/database/merchantWalletOperations"

export type CanonicalWithdrawalActivityStatus =
  | "pending"
  | "sent"
  | "confirmed"
  | "failed"
  | "incomplete"
  | "canceled"
  | "blocked"

/** Raw status values written to wallet_withdrawal_requests.status (Base/Solana). */
export type WalletWithdrawalRequestRawStatus =
  | "draft"
  | "review_required"
  | "blocked"
  | "pending"
  | "processing"
  | "confirmed"
  | "failed"
  | "canceled"

export function mapWalletWithdrawalRequestStatusToActivity(
  status: string,
  hasTxHash: boolean
): CanonicalWithdrawalActivityStatus {
  switch (status) {
    case "confirmed":
      return "confirmed"
    case "failed":
      return "failed"
    case "canceled":
      return "canceled"
    case "blocked":
      return "blocked"
    case "processing":
      return "sent"
    default:
      // "processing" is the only status that always carries a tx_hash today,
      // but a row observed mid-transition (tx_hash written just before the
      // status flip persists) should still read as "sent", not "pending".
      return hasTxHash ? "sent" : "pending"
  }
}

export const WALLET_OPERATION_ACTIVE_CREATED_WINDOW_MS = 5 * 60 * 1000

export function isAbandonedCreatedWalletOperation(input: {
  status: string
  createdAt?: string | null
  updatedAt?: string | null
  providerReference?: string | null
  providerTransactionId?: string | null
  submittedAt?: string | null
}, nowMs = Date.now()): boolean {
  if (input.status !== "CREATED") return false
  if (String(input.providerReference || input.providerTransactionId || input.submittedAt || "").trim()) return false
  const latestKnownWrite = [input.createdAt, input.updatedAt]
    .map((value) => new Date(String(value || "")).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0]
  if (!Number.isFinite(latestKnownWrite)) return false
  return nowMs - latestKnownWrite > WALLET_OPERATION_ACTIVE_CREATED_WINDOW_MS
}

const OPERATION_STATUS_TO_ACTIVITY: Record<WalletOperationStatus, CanonicalWithdrawalActivityStatus> = {
  COMPLETED: "confirmed",
  FAILED: "failed",
  CANCELED: "canceled",
  EXPIRED: "failed",
  PROCESSING: "sent",
  PENDING: "pending",
  CREATED: "pending",
  REQUIRES_ACTION: "pending",
}

export function mapWalletOperationStatusToActivity(
  status: WalletOperationStatus,
  operation?: {
    createdAt?: string | null
    updatedAt?: string | null
    providerReference?: string | null
    providerTransactionId?: string | null
    submittedAt?: string | null
  }
): CanonicalWithdrawalActivityStatus {
  if (operation && isAbandonedCreatedWalletOperation({ status, ...operation })) return "incomplete"
  return OPERATION_STATUS_TO_ACTIVITY[status] ?? "pending"
}

/** Display label used by the post-submit review/confirmation screen (a narrower 3-state UI, not the Activity list). */
export type WithdrawalMerchantStatusLabel = "Processing" | "Confirmed" | "Withdrawal failed"

export function mapWalletWithdrawalRequestStatusToMerchantLabel(
  status: string,
  fallback: WithdrawalMerchantStatusLabel
): WithdrawalMerchantStatusLabel {
  if (status === "confirmed") return "Confirmed"
  if (status === "processing") return "Processing"
  if (status === "failed") return "Withdrawal failed"
  return fallback
}
