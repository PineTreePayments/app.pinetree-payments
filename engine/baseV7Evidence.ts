import { AbiCoder, id, Interface } from "ethers"

export const BASE_V7_PAYMENT_SPLIT_TOPIC = id(
  "PaymentSplit(address,address,uint256,uint256,string,address,address)"
)
export const BASE_USDC_TRANSFER_TOPIC = id("Transfer(address,address,uint256)")
export const BASE_USDC_APPROVAL_TOPIC = id("Approval(address,address,uint256)")

const usdcIface = new Interface([
  "function approve(address spender, uint256 amount) returns (bool)"
])
const v7Iface = new Interface([
  "function payUsdcWithAllowance(address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef)",
  "function payUsdcWithAuthorization((address payer,address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef) payment,(uint256 validAfter,uint256 validBefore,bytes32 nonce) authorization,(uint8 v,bytes32 r,bytes32 s) signature)"
])

const APPROVE_SELECTOR = usdcIface.getFunction("approve")?.selector ?? "0x095ea7b3"
const PAY_USDC_WITH_ALLOWANCE_SELECTOR =
  v7Iface.getFunction("payUsdcWithAllowance")?.selector ?? "0x7fb6346b"
const PAY_USDC_WITH_AUTHORIZATION_SELECTOR =
  v7Iface.getFunction("payUsdcWithAuthorization")?.selector ?? "0x00000000"

export type BaseV7TransactionRole =
  | "allowance_approval"
  | "payment_contract"
  | "unknown"

export type BaseV7ReceiptLog = {
  address: string
  data: string
  topics: string[]
  transactionHash?: string
}

export type BaseV7ReceiptEvidenceInput = {
  txHash: string
  receipt:
    | {
        logs?: BaseV7ReceiptLog[]
        status?: string | number
        blockNumber?: string | number
        gasUsed?: string | number
        contractAddress?: string | null
      }
    | null
  transaction?: {
    to?: string | null
    from?: string | null
    input?: string | null
  } | null
  expectedSplitContract: string
  expectedUsdcToken: string
  expectedMerchantWallet: string
  expectedPineTreeWallet: string
  expectedPaymentRef: string
  expectedMerchantAmountAtomic: string | number
  expectedFeeAmountAtomic: string | number
}

export type BaseV7DetectionResult =
  | {
      kind: "confirmed_payment"
      detected: true
      status: "CONFIRMED"
      txHash: string
      evidence: BaseV7ConfirmedEvidence
    }
  | {
      kind: "failed_transaction"
      detected: true
      status: "FAILED"
      txHash: string
      reason: "receipt_reverted"
      evidence: BaseV7FailedEvidence
    }
  | {
      kind: "wrong_transaction_type"
      detected: true
      status: "PROCESSING"
      txHash: string
      reason: "allowance_approval_hash"
      evidence: BaseV7RoleEvidence
    }
  | {
      kind: "not_found"
      detected: false
      status: "PROCESSING"
      txHash: string
    }
  | {
      kind: "inconclusive"
      detected: false
      status: "PROCESSING"
      txHash: string
      reason: string
      evidence: BaseV7RoleEvidence
    }

export type BaseV7RoleEvidence = {
  receiptStatus?: string
  transactionTo?: string | null
  transactionFrom?: string | null
  transactionSelector?: string
  transactionRole: BaseV7TransactionRole
  logsCount: number
  paymentSplitLogs: number
  decodedPaymentSplitLogs: number
  usdcTransferLogs: number
}

export type BaseV7ConfirmedEvidence = BaseV7RoleEvidence & {
  merchantTransferAmount: string
  pineTreeFeeTransferAmount: string
  paymentRef?: string
  payer?: string
}

export type BaseV7FailedEvidence = BaseV7RoleEvidence

function normalizeAddress(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function selector(input: unknown): string {
  const normalized = String(input || "").trim().toLowerCase()
  return normalized.length >= 10 ? normalized.slice(0, 10) : ""
}

function topicAddress(topic: unknown): string {
  const normalized = String(topic || "").trim().toLowerCase()
  return normalized.length >= 42 ? `0x${normalized.slice(-40)}` : ""
}

function isEvmReceiptFailed(status: unknown): boolean {
  if (status === 0) return true
  const normalized = String(status ?? "").trim().toLowerCase()
  return normalized === "0" || normalized === "0x0" || normalized === "failed"
}

function atomicString(value: unknown): string {
  const normalized = String(value ?? "").trim()
  return /^\d+$/.test(normalized) ? normalized : "0"
}

function amountMeets(received: string, expected: string): boolean {
  return BigInt(received || "0") >= BigInt(expected || "0")
}

export function classifyBaseV7TransactionRole(input: {
  transactionTo?: string | null
  transactionInput?: string | null
  receiptLogs?: BaseV7ReceiptLog[]
  expectedSplitContract: string
  expectedUsdcToken: string
}): BaseV7TransactionRole {
  const to = normalizeAddress(input.transactionTo)
  const splitContract = normalizeAddress(input.expectedSplitContract)
  const usdcToken = normalizeAddress(input.expectedUsdcToken)
  const txSelector = selector(input.transactionInput)
  const logs = Array.isArray(input.receiptLogs) ? input.receiptLogs : []

  if (to === usdcToken && txSelector === APPROVE_SELECTOR) return "allowance_approval"

  if (
    to === splitContract &&
    (txSelector === PAY_USDC_WITH_ALLOWANCE_SELECTOR ||
      txSelector === PAY_USDC_WITH_AUTHORIZATION_SELECTOR)
  ) {
    return "payment_contract"
  }

  if (
    logs.some(
      (log) =>
        normalizeAddress(log.address) === splitContract &&
        String(log.topics?.[0] || "").toLowerCase() === BASE_V7_PAYMENT_SPLIT_TOPIC.toLowerCase()
    )
  ) {
    return "payment_contract"
  }

  if (
    logs.some(
      (log) =>
        normalizeAddress(log.address) === usdcToken &&
        String(log.topics?.[0] || "").toLowerCase() === BASE_USDC_APPROVAL_TOPIC.toLowerCase() &&
        topicAddress(log.topics?.[2]) === splitContract
    )
  ) {
    return "allowance_approval"
  }

  return "unknown"
}

export function evaluateBaseV7ReceiptEvidence(
  input: BaseV7ReceiptEvidenceInput
): BaseV7DetectionResult {
  if (!input.receipt) {
    return {
      kind: "not_found",
      detected: false,
      status: "PROCESSING",
      txHash: input.txHash
    }
  }

  const logs = Array.isArray(input.receipt.logs) ? input.receipt.logs : []
  const role = classifyBaseV7TransactionRole({
    transactionTo: input.transaction?.to,
    transactionInput: input.transaction?.input,
    receiptLogs: logs,
    expectedSplitContract: input.expectedSplitContract,
    expectedUsdcToken: input.expectedUsdcToken
  })
  const baseEvidence: BaseV7RoleEvidence = {
    receiptStatus: String(input.receipt.status ?? "unknown"),
    transactionTo: input.transaction?.to ?? null,
    transactionFrom: input.transaction?.from ?? null,
    transactionSelector: selector(input.transaction?.input),
    transactionRole: role,
    logsCount: logs.length,
    paymentSplitLogs: 0,
    decodedPaymentSplitLogs: 0,
    usdcTransferLogs: 0
  }

  if (role === "allowance_approval") {
    return {
      kind: "wrong_transaction_type",
      detected: true,
      status: "PROCESSING",
      txHash: input.txHash,
      reason: "allowance_approval_hash",
      evidence: baseEvidence
    }
  }

  if (isEvmReceiptFailed(input.receipt.status)) {
    if (role === "payment_contract") {
      return {
        kind: "failed_transaction",
        detected: true,
        status: "FAILED",
        txHash: input.txHash,
        reason: "receipt_reverted",
        evidence: baseEvidence
      }
    }

    return {
      kind: "inconclusive",
      detected: false,
      status: "PROCESSING",
      txHash: input.txHash,
      reason: "reverted_unknown_transaction_type",
      evidence: baseEvidence
    }
  }

  const splitContract = normalizeAddress(input.expectedSplitContract)
  const usdcToken = normalizeAddress(input.expectedUsdcToken)
  const merchantWallet = normalizeAddress(input.expectedMerchantWallet)
  const pineTreeWallet = normalizeAddress(input.expectedPineTreeWallet)
  const expectedMerchant = atomicString(input.expectedMerchantAmountAtomic)
  const expectedFee = atomicString(input.expectedFeeAmountAtomic)

  let splitPaymentRef: string | undefined
  let splitPayer: string | undefined
  let decodedSplitCount = 0
  let paymentSplitLogCount = 0
  for (const log of logs) {
    if (
      normalizeAddress(log.address) !== splitContract ||
      String(log.topics?.[0] || "").toLowerCase() !== BASE_V7_PAYMENT_SPLIT_TOPIC.toLowerCase()
    ) {
      continue
    }
    paymentSplitLogCount += 1
    try {
      const decoded = AbiCoder.defaultAbiCoder().decode(
        ["uint256", "uint256", "string", "address"],
        log.data
      )
      decodedSplitCount += 1
      const merchantAmount = String(decoded[0])
      const feeAmount = String(decoded[1])
      const paymentRef = String(decoded[2])
      const token = normalizeAddress(decoded[3])
      if (
        paymentRef === input.expectedPaymentRef &&
        token === usdcToken &&
        amountMeets(merchantAmount, expectedMerchant) &&
        amountMeets(feeAmount, expectedFee)
      ) {
        splitPaymentRef = paymentRef
        splitPayer = topicAddress(log.topics?.[3]) || undefined
      }
    } catch {
      // Keep counting parser uncertainty; token Transfer evidence below may still prove settlement.
    }
  }

  const transferLogs = logs.filter(
    (log) =>
      normalizeAddress(log.address) === usdcToken &&
      String(log.topics?.[0] || "").toLowerCase() === BASE_USDC_TRANSFER_TOPIC.toLowerCase()
  )
  let merchantTransferAmount = "0"
  let pineTreeFeeTransferAmount = "0"
  for (const log of transferLogs) {
    const to = topicAddress(log.topics?.[2])
    const amount = atomicString(BigInt(log.data).toString())
    if (to === merchantWallet) {
      merchantTransferAmount = (BigInt(merchantTransferAmount) + BigInt(amount)).toString()
    }
    if (to === pineTreeWallet) {
      pineTreeFeeTransferAmount = (BigInt(pineTreeFeeTransferAmount) + BigInt(amount)).toString()
    }
  }

  const evidence: BaseV7ConfirmedEvidence = {
    ...baseEvidence,
    paymentSplitLogs: paymentSplitLogCount,
    decodedPaymentSplitLogs: decodedSplitCount,
    usdcTransferLogs: transferLogs.length,
    merchantTransferAmount,
    pineTreeFeeTransferAmount,
    paymentRef: splitPaymentRef,
    payer: splitPayer
  }

  const hasExactTransfers =
    amountMeets(merchantTransferAmount, expectedMerchant) &&
    amountMeets(pineTreeFeeTransferAmount, expectedFee)
  if (role === "payment_contract" && (splitPaymentRef || hasExactTransfers)) {
    return {
      kind: "confirmed_payment",
      detected: true,
      status: "CONFIRMED",
      txHash: input.txHash,
      evidence
    }
  }

  return {
    kind: "inconclusive",
    detected: false,
    status: "PROCESSING",
    txHash: input.txHash,
    reason:
      role === "unknown"
        ? "unknown_transaction_type"
        : "successful_receipt_without_required_payment_evidence",
    evidence
  }
}
