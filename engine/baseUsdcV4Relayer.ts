import {
  Contract,
  JsonRpcProvider,
  Signature,
  Wallet,
  formatEther,
  getAddress,
  hexlify,
  randomBytes,
  verifyTypedData
} from "ethers"
import { getPaymentById } from "@/database"
import {
  getTransactionByPaymentId,
  updateTransactionProviderReference
} from "@/database/transactions"
import type { StoredPaymentSplitMetadata } from "@/types/payment"
import {
  getBaseUsdcAuthValiditySeconds,
  getBaseUsdcGasCap,
  getBaseUsdcRelayer,
  getBaseUsdcTokenAddress,
  getBaseUsdcV4Contract,
  getPineTreeTreasuryWallet,
  getRpcUrl
} from "./config"
import { getMarketPricesUSD } from "./marketPrices"

const BASE_CHAIN_ID = 8453
const BASE_USDC_UNAVAILABLE_MESSAGE =
  "Base USDC is temporarily unavailable because current network costs are above PineTree’s limit. Please try again shortly or choose another payment method."

const TERMINAL_PAYMENT_STATUSES = new Set([
  "CONFIRMED",
  "FAILED",
  "INCOMPLETE",
  "EXPIRED",
  "REFUNDED"
])

const V4_ABI = [
  "function payWithUsdcAuthorization((address payer,address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef) payment,(uint256 validAfter,uint256 validBefore,bytes32 nonce) authorization,(uint8 v,bytes32 r,bytes32 s) signature)"
] as const

type BaseUsdcV4Authorization = {
  validAfter: string
  validBefore: string
  nonce: string
}

type BaseUsdcV4TypedDataInput = {
  payerAddress: string
  value: string | bigint
  validAfter: string | number | bigint
  validBefore: string | number | bigint
  nonce: string
}

type BaseUsdcV4PaymentContext = {
  paymentId: string
  payerAddress: string
  merchantWallet: string
  treasuryWallet: string
  merchantAmount: bigint
  feeAmount: bigint
  totalAmount: bigint
  splitContract: string
}

export type BaseUsdcV4UnavailableResponse = {
  ok: false
  unavailable: true
  code: "BASE_USDC_TEMPORARILY_UNAVAILABLE"
  message: string
}

export type BaseUsdcV4RelayResponse =
  | { ok: true; txHash: string }
  | BaseUsdcV4UnavailableResponse

function unavailable(): BaseUsdcV4UnavailableResponse {
  return {
    ok: false,
    unavailable: true,
    code: "BASE_USDC_TEMPORARILY_UNAVAILABLE",
    message: BASE_USDC_UNAVAILABLE_MESSAGE
  }
}

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

function normalizeAuthorization(input: BaseUsdcV4Authorization): BaseUsdcV4Authorization {
  const validAfter = String(input.validAfter ?? "").trim()
  const validBefore = String(input.validBefore ?? "").trim()
  const nonce = String(input.nonce || "").trim()

  if (!/^\d+$/.test(validAfter) || !/^\d+$/.test(validBefore)) {
    throw new Error("Invalid Base USDC authorization validity window")
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(nonce)) {
    throw new Error("Invalid Base USDC authorization nonce")
  }

  return { validAfter, validBefore, nonce }
}

function isSameAddress(left: string, right: string): boolean {
  return requireEvmAddress("address", left) === requireEvmAddress("address", right)
}

async function loadValidatedPaymentContext(input: {
  paymentId: string
  payerAddress: string
  allowTerminal: boolean
}): Promise<BaseUsdcV4PaymentContext> {
  const paymentId = String(input.paymentId || "").trim()
  if (!paymentId) throw new Error("Missing paymentId")

  const payerAddress = requireEvmAddress("payerAddress", input.payerAddress)
  const payment = await getPaymentById(paymentId)
  if (!payment) throw new Error("Payment not found")

  const status = String(payment.status || "").toUpperCase()
  if (input.allowTerminal ? false : TERMINAL_PAYMENT_STATUSES.has(status)) {
    throw new Error("Payment is already terminal")
  }
  if (!["CREATED", "PENDING", "PROCESSING"].includes(status)) {
    throw new Error("Payment is not active")
  }

  if (String(payment.network || "").toLowerCase().trim() !== "base") {
    throw new Error("Base USDC V4 authorization is only available for Base payments")
  }

  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
  if (!split) throw new Error("Payment split metadata is missing")

  if (String(split.asset || "").toUpperCase() !== "USDC") {
    throw new Error("Payment is not a Base USDC payment")
  }

  if (split.baseUsdcStrategy !== "v4_eip3009_relayer") {
    throw new Error("Payment is not configured for Base USDC V4 relayer")
  }

  const splitContract = getBaseUsdcV4Contract()
  if (!isSameAddress(String(split.splitContract || ""), splitContract)) {
    throw new Error("Payment split contract does not match Base USDC V4 contract")
  }

  const merchantWallet = requireEvmAddress("merchantWallet", String(split.merchantWallet || ""))
  const treasuryWallet = requireEvmAddress("PINETREE_TREASURY_WALLET_BASE", getPineTreeTreasuryWallet("base"))
  const splitTreasuryWallet = requireEvmAddress("pinetreeWallet", String(split.pinetreeWallet || ""))

  if (treasuryWallet !== splitTreasuryWallet) {
    throw new Error("Payment treasury does not match PINETREE_TREASURY_WALLET_BASE")
  }

  const merchantAmount = requireAtomicAmount("merchantNativeAmountAtomic", split.merchantNativeAmountAtomic)
  const feeAmount = requireAtomicAmount("feeNativeAmountAtomic", split.feeNativeAmountAtomic)

  return {
    paymentId: payment.id,
    payerAddress,
    merchantWallet,
    treasuryWallet,
    merchantAmount,
    feeAmount,
    totalAmount: merchantAmount + feeAmount,
    splitContract: requireEvmAddress("PINETREE_BASE_USDC_V4_CONTRACT", splitContract)
  }
}

export function buildBaseUsdcV4TypedData(input: BaseUsdcV4TypedDataInput) {
  const authorization = normalizeAuthorization({
    validAfter: String(input.validAfter),
    validBefore: String(input.validBefore),
    nonce: input.nonce
  })
  const value = String(input.value)

  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
    throw new Error("Invalid Base USDC authorization value")
  }

  return {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: BASE_CHAIN_ID,
      verifyingContract: getBaseUsdcTokenAddress()
    },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: requireEvmAddress("payerAddress", input.payerAddress),
      to: getBaseUsdcV4Contract(),
      value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce
    }
  }
}

export async function getBaseUsdcV4Availability(): Promise<BaseUsdcV4UnavailableResponse | { ok: true }> {
  try {
    getBaseUsdcV4Contract()
    getBaseUsdcTokenAddress()
    getBaseUsdcRelayer()
    getBaseUsdcGasCap()
    getBaseUsdcAuthValiditySeconds()
    getPineTreeTreasuryWallet("base")
    getRpcUrl("base")
    return { ok: true }
  } catch {
    return unavailable()
  }
}

export async function prepareBaseUsdcV4Authorization(input: {
  paymentId: string
  payerAddress: string
}) {
  const availability = await getBaseUsdcV4Availability()
  if (!availability.ok) return availability

  const context = await loadValidatedPaymentContext({
    paymentId: input.paymentId,
    payerAddress: input.payerAddress,
    allowTerminal: false
  })
  const now = Math.floor(Date.now() / 1000)
  const authorization: BaseUsdcV4Authorization = {
    validAfter: "0",
    validBefore: String(now + getBaseUsdcAuthValiditySeconds()),
    nonce: hexlify(randomBytes(32))
  }
  const typedData = buildBaseUsdcV4TypedData({
    payerAddress: context.payerAddress,
    value: context.totalAmount,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce
  })

  return {
    ok: true,
    paymentId: context.paymentId,
    typedData,
    authorization,
    value: context.totalAmount.toString()
  }
}

export async function relayBaseUsdcV4Payment(input: {
  paymentId: string
  payerAddress: string
  authorization: BaseUsdcV4Authorization
  signature: string
}): Promise<BaseUsdcV4RelayResponse> {
  const availability = await getBaseUsdcV4Availability()
  if (!availability.ok) return availability

  const existingTransaction = await getTransactionByPaymentId(input.paymentId)
  const existingTxHash = String(existingTransaction?.provider_transaction_id || "").trim()
  if (/^0x[a-fA-F0-9]{64}$/.test(existingTxHash)) {
    return { ok: true, txHash: existingTxHash }
  }

  const context = await loadValidatedPaymentContext({
    paymentId: input.paymentId,
    payerAddress: input.payerAddress,
    allowTerminal: false
  })
  const authorization = normalizeAuthorization(input.authorization)
  const typedData = buildBaseUsdcV4TypedData({
    payerAddress: context.payerAddress,
    value: context.totalAmount,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce
  })
  const recovered = getAddress(verifyTypedData(
    typedData.domain,
    typedData.types,
    typedData.message,
    input.signature
  ))

  if (recovered !== context.payerAddress) {
    throw new Error("Base USDC authorization signature does not match payer")
  }

  const signature = Signature.from(input.signature)
  const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
  const { privateKey } = getBaseUsdcRelayer()
  const relayer = new Wallet(privateKey, provider)
  const contract = new Contract(context.splitContract, V4_ABI, relayer)
  const paymentArgs = {
    payer: context.payerAddress,
    merchant: context.merchantWallet,
    treasury: context.treasuryWallet,
    merchantAmount: context.merchantAmount,
    feeAmount: context.feeAmount,
    paymentRef: context.paymentId
  }
  const authorizationArgs = {
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce
  }
  const signatureArgs = {
    v: signature.v,
    r: signature.r,
    s: signature.s
  }

  const estimatedGas = await contract.payWithUsdcAuthorization.estimateGas(
    paymentArgs,
    authorizationArgs,
    signatureArgs
  )
  const feeData = await provider.getFeeData()
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice
  if (!gasPrice) return unavailable()

  const gasCostWei = estimatedGas * gasPrice
  const prices = await getMarketPricesUSD()
  const gasCostUsd = Number(formatEther(gasCostWei)) * prices.ETH
  const { maxGasUsd } = getBaseUsdcGasCap()
  if (!Number.isFinite(gasCostUsd) || gasCostUsd > maxGasUsd) {
    return unavailable()
  }

  const relayerBalance = await provider.getBalance(relayer.address)
  if (relayerBalance < gasCostWei) {
    return unavailable()
  }

  const tx = await contract.payWithUsdcAuthorization(
    paymentArgs,
    authorizationArgs,
    signatureArgs
  )
  const txHash = String(tx.hash || "")
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error("Base USDC relayer did not return a transaction hash")
  }

  if (existingTransaction?.id) {
    await updateTransactionProviderReference(existingTransaction.id, txHash)
  }

  return { ok: true, txHash }
}