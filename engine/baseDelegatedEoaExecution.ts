import { Interface, getAddress } from "ethers"
import { getPaymentById } from "@/database"
import type { StoredPaymentSplitMetadata } from "@/types/payment"
import {
  getBaseUsdcTokenAddress,
  getBaseV5SplitContract,
  getPineTreeTreasuryWallet,
  isBaseDelegatedEoaEnabled,
} from "./config"

const BASE_CHAIN_ID = 8453

const TERMINAL_PAYMENT_STATUSES = new Set([
  "CONFIRMED",
  "FAILED",
  "INCOMPLETE",
  "EXPIRED",
  "REFUNDED",
])

const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
] as const

const V5_ABI = [
  "function payUsdcWithAllowance(address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef)",
] as const

const usdcIface = new Interface(USDC_ABI)
const v5Iface = new Interface(V5_ABI)

// ─── Public types ─────────────────────────────────────────────────────────────

export type BaseDelegatedEoaWalletCall = {
  to: string
  value: "0x0"
  data: string
}

type DelegatedCallSummary = {
  kind: "approve" | "v5-payment"
  to: "BASE_USDC" | "PINE_TREE_V5"
  target: string
  redacted: boolean
}

export type BaseDelegatedEoaPrepareResult = {
  ok: true
  enabled: boolean
  paymentId: string
  payerAddress: string
  strategy: "delegated_eoa_batch"
  chainId: number
  calls: BaseDelegatedEoaWalletCall[]
  callSummaries: DelegatedCallSummary[]
  requiredUsdcAmount: string
  v5Contract: string
  usdcToken: string
  warnings: string[]
}

export type BaseDelegatedEoaStatusResult =
  | { ok: true; status: "pending"; txHash: null; warnings: string[] }
  | { ok: true; status: "included"; txHash: string; warnings: string[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireEvmAddress(label: string, value: string): string {
  try {
    return getAddress(String(value || "").trim())
  } catch {
    throw new Error(`Invalid ${label}. Expected a valid 0x EVM address.`)
  }
}

function requireAtomicAmount(label: string, value: unknown): bigint {
  const normalized = String(value ?? "").trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid ${label}. Expected an atomic integer string.`)
  }

  const amount = BigInt(normalized)
  if (amount <= BigInt(0)) {
    throw new Error(`Invalid ${label}. Expected an amount greater than zero.`)
  }

  return amount
}

function isSameAddress(left: string, right: string): boolean {
  return requireEvmAddress("address", left) === requireEvmAddress("address", right)
}

function normalizeTxHash(value: unknown): string | null {
  const txHash = String(value || "").trim()
  return /^0x[a-fA-F0-9]{64}$/.test(txHash) ? txHash : null
}

// ─── Payment context loader ───────────────────────────────────────────────────

async function loadDelegatedBaseUsdcContext(input: {
  paymentId: string
  payerAddress: string
}) {
  const paymentId = String(input.paymentId || "").trim()
  if (!paymentId) throw new Error("Missing paymentId")

  const payerAddress = requireEvmAddress("payerAddress", input.payerAddress)
  const payment = await getPaymentById(paymentId)
  if (!payment) throw new Error("Payment not found")

  const status = String(payment.status || "").toUpperCase()
  if (TERMINAL_PAYMENT_STATUSES.has(status)) {
    throw new Error("Payment is already terminal")
  }
  if (!["CREATED", "PENDING", "PROCESSING"].includes(status)) {
    throw new Error("Payment is not active")
  }

  if (String(payment.network || "").toLowerCase().trim() !== "base") {
    throw new Error("Delegated EOA payment is only available for Base payments")
  }

  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
  if (!split) throw new Error("Payment split metadata is missing")

  if (String(split.asset || "").toUpperCase() !== "USDC") {
    throw new Error("Delegated EOA payment is only available for Base USDC payments")
  }

  const v5Contract = requireEvmAddress("PINETREE_BASE_SPLIT_V5_CONTRACT", getBaseV5SplitContract())
  const metadataSplitContract = String(split.splitContract || "").trim()
  if (metadataSplitContract && !isSameAddress(metadataSplitContract, v5Contract)) {
    throw new Error("Payment split contract does not match Base V5 contract")
  }

  const usdcToken = requireEvmAddress("PINETREE_BASE_USDC_TOKEN_ADDRESS", getBaseUsdcTokenAddress())
  const merchantWallet = requireEvmAddress("merchantWallet", String(split.merchantWallet || ""))
  const treasuryWallet = requireEvmAddress("PINETREE_TREASURY_WALLET_BASE", getPineTreeTreasuryWallet("base"))
  const splitTreasuryWallet = requireEvmAddress("pinetreeWallet", String(split.pinetreeWallet || ""))

  if (treasuryWallet !== splitTreasuryWallet) {
    throw new Error("Payment treasury does not match PINETREE_TREASURY_WALLET_BASE")
  }

  const merchantAmount = requireAtomicAmount("merchantNativeAmountAtomic", split.merchantNativeAmountAtomic)
  const feeAmount = requireAtomicAmount("feeNativeAmountAtomic", split.feeNativeAmountAtomic)
  const totalAmount = merchantAmount + feeAmount

  return {
    paymentId,
    payerAddress,
    usdcToken,
    v5Contract,
    merchantWallet,
    treasuryWallet,
    merchantAmount,
    feeAmount,
    totalAmount,
  }
}

// ─── Prepare delegated payment ────────────────────────────────────────────────

export async function prepareBaseUsdcDelegatedPayment(input: {
  paymentId: string
  payerAddress: string
}): Promise<BaseDelegatedEoaPrepareResult> {
  const enabled = isBaseDelegatedEoaEnabled()
  const payerAddress = requireEvmAddress("payerAddress", input.payerAddress)
  const paymentId = String(input.paymentId || "").trim()

  if (!enabled) {
    return {
      ok: true,
      enabled: false,
      paymentId,
      payerAddress,
      strategy: "delegated_eoa_batch",
      chainId: BASE_CHAIN_ID,
      calls: [],
      callSummaries: [],
      requiredUsdcAmount: "0",
      v5Contract: "",
      usdcToken: "",
      warnings: [
        "Delegated EOA payment is disabled. Set PINETREE_BASE_DELEGATED_EOA_ENABLED=true to enable.",
      ],
    }
  }

  console.info("[BASE DELEGATED] prepare-start", {
    paymentId,
    payerAddress,
    strategy: "delegated_eoa_batch",
  })

  const context = await loadDelegatedBaseUsdcContext({ paymentId, payerAddress })

  const approveCall: BaseDelegatedEoaWalletCall = {
    to: context.usdcToken,
    value: "0x0",
    data: usdcIface.encodeFunctionData("approve", [context.v5Contract, context.totalAmount]),
  }

  const paymentCall: BaseDelegatedEoaWalletCall = {
    to: context.v5Contract,
    value: "0x0",
    data: v5Iface.encodeFunctionData("payUsdcWithAllowance", [
      context.merchantWallet,
      context.treasuryWallet,
      context.merchantAmount,
      context.feeAmount,
      context.paymentId,
    ]),
  }

  console.info("[BASE DELEGATED] prepare-success", {
    paymentId: context.paymentId,
    payerAddress: context.payerAddress,
    chainId: BASE_CHAIN_ID,
    requiredUsdcAmount: context.totalAmount.toString(),
    callKinds: ["approve", "v5-payment"],
  })

  return {
    ok: true,
    enabled: true,
    paymentId: context.paymentId,
    payerAddress: context.payerAddress,
    strategy: "delegated_eoa_batch",
    chainId: BASE_CHAIN_ID,
    calls: [approveCall, paymentCall],
    callSummaries: [
      {
        kind: "approve",
        to: "BASE_USDC",
        target: context.usdcToken,
        redacted: true,
      },
      {
        kind: "v5-payment",
        to: "PINE_TREE_V5",
        target: context.v5Contract,
        redacted: true,
      },
    ],
    requiredUsdcAmount: context.totalAmount.toString(),
    v5Contract: context.v5Contract,
    usdcToken: context.usdcToken,
    warnings: [
      "Only a final included V5 transaction hash may be sent to /detect.",
      "Do not treat a call id or batch id as a transaction hash.",
    ],
  }
}

// ─── Resolve delegated status ─────────────────────────────────────────────────

export async function resolveBaseUsdcDelegatedStatus(input: {
  callId: string
  payerAddress: string
  txHash?: string | null
}): Promise<BaseDelegatedEoaStatusResult> {
  requireEvmAddress("payerAddress", input.payerAddress)
  const callId = String(input.callId || "").trim()
  if (!callId) throw new Error("Missing callId")

  const txHash = normalizeTxHash(input.txHash)
  if (txHash) {
    console.info("[BASE DELEGATED] final-tx-resolved", {
      txHashPrefix: txHash.slice(0, 10),
      source: "delegated-status-route",
    })
    return {
      ok: true,
      status: "included",
      txHash,
      warnings: ["Only pass this final transaction hash to /detect after client wallet status confirms inclusion."],
    }
  }

  return {
    ok: true,
    status: "pending",
    txHash: null,
    warnings: [
      "Server cannot query wallet_getCallsStatus without the connected wallet provider.",
      "Use wallet_getCallsStatus client-side and call this route only after a final transaction hash is known.",
    ],
  }
}
