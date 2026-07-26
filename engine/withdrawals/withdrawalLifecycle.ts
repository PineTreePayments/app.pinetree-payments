import type { WalletOperationStatus } from "@/database/merchantWalletOperations"

export type CanonicalWithdrawalLifecycleState =
  | "DRAFT"
  | "REVIEW"
  | "AWAITING_AUTHORIZATION"
  | "SIGNED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "CONFIRMING"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED"

export type WithdrawalMerchantStatusLabel =
  | "Review withdrawal"
  | "Authorize withdrawal in your wallet"
  | "Submitting withdrawal"
  | "Withdrawal submitted"
  | "Withdrawal confirming"
  | "Withdrawal confirmed"
  | "Withdrawal failed"
  | "Withdrawal cancelled"

export const TERMINAL_WITHDRAWAL_LIFECYCLE_STATES = new Set<CanonicalWithdrawalLifecycleState>([
  "CONFIRMED",
  "FAILED",
  "CANCELLED",
])

export function isTerminalWithdrawalLifecycleState(state: CanonicalWithdrawalLifecycleState): boolean {
  return TERMINAL_WITHDRAWAL_LIFECYCLE_STATES.has(state)
}

export function normalizeWalletWithdrawalRequestLifecycle(input: {
  status: string
  txHash?: string | null
  providerReference?: string | null
  signedPayload?: unknown
}): CanonicalWithdrawalLifecycleState {
  const status = String(input.status || "").trim().toLowerCase()
  const hasProviderEvidence = Boolean(String(input.txHash || input.providerReference || "").trim())
  if (status === "confirmed") return "CONFIRMED"
  if (status === "failed") return "FAILED"
  if (status === "canceled" || status === "cancelled") return "CANCELLED"
  if (status === "processing") return hasProviderEvidence ? "CONFIRMING" : "SUBMITTING"
  if (status === "pending") return input.signedPayload ? "SIGNED" : "AWAITING_AUTHORIZATION"
  if (status === "review_required") return "REVIEW"
  return "DRAFT"
}

export function normalizeWalletOperationLifecycle(input: {
  status: WalletOperationStatus | string
  providerReference?: string | null
  providerTransactionId?: string | null
  txHash?: string | null
  submittedAt?: string | null
}): CanonicalWithdrawalLifecycleState {
  const status = String(input.status || "").trim().toUpperCase()
  const hasProviderEvidence = Boolean(
    String(input.providerReference || input.providerTransactionId || input.txHash || input.submittedAt || "").trim()
  )
  if (status === "COMPLETED") return "CONFIRMED"
  if (status === "FAILED" || status === "EXPIRED") return "FAILED"
  if (status === "CANCELED" || status === "CANCELLED") return "CANCELLED"
  if (status === "PROCESSING") return hasProviderEvidence ? "CONFIRMING" : "SUBMITTING"
  if (status === "REQUIRES_ACTION" || status === "ACTION_REQUIRED") return hasProviderEvidence ? "SUBMITTED" : "AWAITING_AUTHORIZATION"
  if (status === "PENDING") return "SUBMITTED"
  return "DRAFT"
}

export function withdrawalLifecycleLabel(state: CanonicalWithdrawalLifecycleState): WithdrawalMerchantStatusLabel {
  switch (state) {
    case "REVIEW":
      return "Review withdrawal"
    case "AWAITING_AUTHORIZATION":
      return "Authorize withdrawal in your wallet"
    case "SIGNED":
    case "SUBMITTING":
      return "Submitting withdrawal"
    case "SUBMITTED":
      return "Withdrawal submitted"
    case "CONFIRMING":
      return "Withdrawal confirming"
    case "CONFIRMED":
      return "Withdrawal confirmed"
    case "FAILED":
      return "Withdrawal failed"
    case "CANCELLED":
      return "Withdrawal cancelled"
    default:
      return "Review withdrawal"
  }
}

export function walletWithdrawalRequestStatusIsTerminal(status: string): boolean {
  return ["confirmed", "failed", "canceled", "cancelled"].includes(String(status || "").trim().toLowerCase())
}

export function walletOperationStatusIsTerminal(status: string): boolean {
  return ["COMPLETED", "FAILED", "CANCELED", "CANCELLED", "EXPIRED"].includes(String(status || "").trim().toUpperCase())
}

export function shouldPreserveTerminalWithdrawalStatus(currentStatus: string, nextStatus: string | undefined): boolean {
  if (!nextStatus) return false
  if (!walletWithdrawalRequestStatusIsTerminal(currentStatus)) return false
  return String(currentStatus).toLowerCase() !== String(nextStatus).toLowerCase()
}

export function shouldPreserveTerminalOperationStatus(currentStatus: string, nextStatus: string | undefined): boolean {
  if (!nextStatus) return false
  if (!walletOperationStatusIsTerminal(currentStatus)) return false
  return String(currentStatus).toUpperCase() !== String(nextStatus).toUpperCase()
}
