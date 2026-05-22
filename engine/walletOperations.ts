// Wallet operation foundation types and validation.
// No real transaction logic is implemented here.
// Real fund movement requires merchant approval plus wallet/provider execution
// in a future Engine-owned workflow.

export type WalletOperationRail =
  | "bitcoin_lightning"
  | "base"
  | "solana"
  | "ethereum"

export type WalletOperationType =
  | "SEND_CRYPTO"
  | "CASH_OUT"
  | "PROVIDER_ACTION"

// Operation lifecycle for a future audit trail.
// CREATED -> SETUP_REQUIRED / AWAITING_APPROVAL -> SUBMITTED -> PROCESSING -> COMPLETED
// Any operation can move to FAILED or CANCELLED before completion.
export type WalletOperationStatus =
  | "CREATED"
  | "SETUP_REQUIRED"
  | "AWAITING_APPROVAL"
  | "SUBMITTED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"

export type WalletOperationRequest = {
  merchantId: string
  walletId: string
  rail: WalletOperationRail
  type: WalletOperationType
}

export type WalletOperationValidationResult =
  | { valid: true }
  | { valid: false; reason: string }

const VALID_RAILS: WalletOperationRail[] = [
  "bitcoin_lightning",
  "base",
  "solana",
  "ethereum"
]

const VALID_TYPES: WalletOperationType[] = [
  "SEND_CRYPTO",
  "CASH_OUT",
  "PROVIDER_ACTION"
]

export function validateWalletOperationRequest(
  req: WalletOperationRequest
): WalletOperationValidationResult {
  if (!req.merchantId?.trim()) {
    return { valid: false, reason: "Missing merchant ID" }
  }
  if (!req.walletId?.trim()) {
    return { valid: false, reason: "Missing wallet ID" }
  }
  if (!VALID_RAILS.includes(req.rail)) {
    return { valid: false, reason: `Unsupported rail: ${req.rail}` }
  }
  if (!VALID_TYPES.includes(req.type)) {
    return { valid: false, reason: `Unsupported operation type: ${req.type}` }
  }
  return { valid: true }
}
