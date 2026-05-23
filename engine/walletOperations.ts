import {
  createWalletOperation,
  recordWalletOperationEvent,
  type WalletOperationRecord
} from "@/database/walletOperations"
import { getMerchantLightningSetup } from "@/database/merchantProviders"
import { getSpeedAccountBalanceDiagnostics } from "@/providers/lightning/getBalance"

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
// DRAFT -> AWAITING_CONFIRMATION -> READY_TO_SUBMIT -> SUBMITTED -> PROCESSING -> COMPLETED.
// This phase only creates DRAFT or VALIDATION_FAILED records.
export type WalletOperationStatus =
  | "CREATED"
  | "DRAFT"
  | "VALIDATION_FAILED"
  | "AWAITING_CONFIRMATION"
  | "AWAITING_APPROVAL"
  | "READY_TO_SUBMIT"
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

export type SpeedWithdrawalDestinationType =
  | "lightning_invoice"
  | "bitcoin_address"
  | "provider_bank_payout"

export type CreateSpeedWithdrawalDraftInput = {
  merchantId: string
  walletId?: string | null
  amount: number
  destinationType: SpeedWithdrawalDestinationType
  destinationValue?: string | null
  memo?: string | null
}

export type SpeedWithdrawalDraftResult = {
  success: boolean
  operation: {
    id: string
    provider: "speed"
    operationType: "WITHDRAWAL_DRAFT"
    asset: "BTC"
    network: "bitcoin_lightning"
    amount: number
    destinationType: SpeedWithdrawalDestinationType
    destinationValue: string | null
    status: WalletOperationStatus
    errorCode: string | null
    errorMessage: string | null
    providerOperationId: null
    providerStatus: null
    createdAt: string
  }
  eventType: string
  providerCallsEnabled: false
  fundMovementEnabled: false
  nextStep: "MERCHANT_REVIEWS_WITHDRAWAL_DRAFT" | "FIX_VALIDATION_ERRORS"
  message: string
}

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

function createStatusError(message: string, status: number) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}

function isLikelyBolt11Invoice(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return /^ln(bc|tb|bcrt)[a-z0-9]{20,}$/i.test(normalized)
}

function isLikelyBitcoinAddress(value: string): boolean {
  const normalized = value.trim()
  return /^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{20,90}$/.test(normalized)
}

function summarizeOperation(row: WalletOperationRecord): SpeedWithdrawalDraftResult["operation"] {
  return {
    id: row.id,
    provider: "speed",
    operationType: "WITHDRAWAL_DRAFT",
    asset: "BTC",
    network: "bitcoin_lightning",
    amount: Number(row.amount),
    destinationType: row.destination_type as SpeedWithdrawalDestinationType,
    destinationValue: row.destination_value,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    providerOperationId: null,
    providerStatus: null,
    createdAt: row.created_at
  }
}

function buildBalanceValidationMetadata(input: Awaited<ReturnType<typeof getSpeedAccountBalanceDiagnostics>>) {
  return {
    balanceValidation: input.balanceSource === "none" ? "unavailable" : "checked",
    balanceSource: input.balanceSource,
    availableBalanceBtc: input.btcAmount,
    availableBalanceSats: input.satsAmount,
    balanceLookupStatus: input.httpStatus,
    balanceLookupError: input.error || null
  }
}

async function createSpeedWithdrawalValidationFailure(
  input: CreateSpeedWithdrawalDraftInput,
  errorCode: string,
  errorMessage: string,
  metadata: Record<string, unknown>
): Promise<SpeedWithdrawalDraftResult> {
  const operation = await createWalletOperation({
    merchantId: input.merchantId,
    provider: "speed",
    operationType: "WITHDRAWAL_DRAFT",
    asset: "BTC",
    network: "bitcoin_lightning",
    amount: Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0,
    destinationType: input.destinationType,
    destinationValue: input.destinationValue || null,
    status: "VALIDATION_FAILED",
    errorCode,
    errorMessage,
    metadata: {
      ...metadata,
      walletId: input.walletId || null,
      memo: input.memo || null,
      providerCallsEnabled: false,
      fundMovementEnabled: false
    }
  })

  await recordWalletOperationEvent({
    walletOperationId: operation.id,
    merchantId: input.merchantId,
    eventType: "wallet.speed_withdrawal.validation_failed",
    provider: "speed",
    rawPayload: {
      errorCode,
      errorMessage,
      destinationType: input.destinationType,
      providerCallsEnabled: false,
      fundMovementEnabled: false
    }
  })

  return {
    success: false,
    operation: summarizeOperation(operation),
    eventType: "wallet.speed_withdrawal.validation_failed",
    providerCallsEnabled: false,
    fundMovementEnabled: false,
    nextStep: "FIX_VALIDATION_ERRORS",
    message: errorMessage
  }
}

export async function createSpeedWithdrawalDraftForMerchant(
  input: CreateSpeedWithdrawalDraftInput
): Promise<SpeedWithdrawalDraftResult> {
  if (!input.merchantId?.trim()) {
    throw createStatusError("Missing merchant ID", 400)
  }

  const lightningSetup = await getMerchantLightningSetup(input.merchantId)
  if (!lightningSetup) {
    throw createStatusError("Speed provider is not configured for this merchant.", 503)
  }

  const amount = Number(input.amount)
  const destinationType = input.destinationType
  const destinationValue = String(input.destinationValue || "").trim()
  const memo = String(input.memo || "").trim()

  if (!Number.isFinite(amount) || amount <= 0) {
    return createSpeedWithdrawalValidationFailure(
      { ...input, amount: Number.isFinite(amount) ? amount : 0 },
      "INVALID_AMOUNT",
      "Withdrawal amount must be greater than zero.",
      { validation: "amount" }
    )
  }

  if (destinationType === "provider_bank_payout") {
    return createSpeedWithdrawalValidationFailure(
      input,
      "BANK_PAYOUT_NOT_ENABLED",
      "Speed bank payout support is not enabled yet.",
      { validation: "destinationType" }
    )
  }

  if (destinationType === "lightning_invoice" && !isLikelyBolt11Invoice(destinationValue)) {
    return createSpeedWithdrawalValidationFailure(
      input,
      "INVALID_LIGHTNING_INVOICE",
      "Destination must look like a BOLT11 Lightning invoice.",
      { validation: "destinationValue" }
    )
  }

  if (destinationType === "bitcoin_address" && !isLikelyBitcoinAddress(destinationValue)) {
    return createSpeedWithdrawalValidationFailure(
      input,
      "INVALID_BITCOIN_ADDRESS",
      "Destination must look like a Bitcoin address.",
      { validation: "destinationValue" }
    )
  }

  const balance = await getSpeedAccountBalanceDiagnostics(lightningSetup.speedAccountId)
  const balanceMetadata = buildBalanceValidationMetadata(balance)

  if (balance.balanceSource !== "none" && amount > balance.btcAmount) {
    return createSpeedWithdrawalValidationFailure(
      input,
      "INSUFFICIENT_AVAILABLE_BALANCE",
      "Withdrawal amount is greater than the available Bitcoin Lightning balance.",
      {
        validation: "availableBalance",
        ...balanceMetadata
      }
    )
  }

  const operation = await createWalletOperation({
    merchantId: input.merchantId,
    provider: "speed",
    operationType: "WITHDRAWAL_DRAFT",
    asset: "BTC",
    network: "bitcoin_lightning",
    amount,
    destinationType,
    destinationValue,
    status: "DRAFT",
    metadata: {
      walletId: input.walletId || null,
      memo: memo || null,
      speedAccountConfigured: Boolean(lightningSetup.speedAccountId),
      lightningAddressConfigured: Boolean(lightningSetup.lightningAddress),
      accountSource: lightningSetup.accountSource,
      ...balanceMetadata,
      providerCallsEnabled: false,
      fundMovementEnabled: false,
      providerSubmissionEnabled: false
    }
  })

  await recordWalletOperationEvent({
    walletOperationId: operation.id,
    merchantId: input.merchantId,
    eventType: "wallet.speed_withdrawal.draft_created",
    provider: "speed",
    rawPayload: {
      destinationType,
      amount,
      providerCallsEnabled: false,
      fundMovementEnabled: false,
      providerSubmissionEnabled: false
    }
  })

  return {
    success: true,
    operation: summarizeOperation(operation),
    eventType: "wallet.speed_withdrawal.draft_created",
    providerCallsEnabled: false,
    fundMovementEnabled: false,
    nextStep: "MERCHANT_REVIEWS_WITHDRAWAL_DRAFT",
    message: "Withdrawal draft created. Provider submission is disabled until Speed withdrawal endpoints are confirmed."
  }
}
