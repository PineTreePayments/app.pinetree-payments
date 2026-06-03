import {
  Contract,
  Interface,
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
  getBaseV7AuthValiditySeconds,
  getBaseV7Contract,
  getBaseV7GasCap,
  getBaseV7Relayer,
  getBaseV7UsdcToken,
  getPineTreeTreasuryWallet,
  getRpcUrl
} from "./config"
import { getMarketPricesUSD } from "./marketPrices"

const BASE_CHAIN_ID = 8453
const BASE_USDC_UNAVAILABLE_MESSAGE =
  "Base USDC is temporarily unavailable because current network costs are above PineTree's limit. Please try again shortly or choose another payment method."

const TERMINAL_PAYMENT_STATUSES = new Set([
  "CONFIRMED",
  "FAILED",
  "INCOMPLETE",
  "EXPIRED",
  "REFUNDED"
])

const V7_ABI = [
  "function payUsdcWithAuthorization((address payer,address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef) payment,(uint256 validAfter,uint256 validBefore,bytes32 nonce) authorization,(uint8 v,bytes32 r,bytes32 s) signature)",
  "function payUsdcWithAllowance(address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef)",
  "function relayers(address relayer) view returns (bool)",
  "function isPaymentRefUsed(string paymentRef) view returns (bool)",
  "function pineTreeTreasury() view returns (address)"
] as const

const USDC_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
] as const

const usdcIface = new Interface([
  "function approve(address spender, uint256 amount) returns (bool)"
])

const v7Iface = new Interface([
  "function payUsdcWithAllowance(address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef)"
])

// ─── Types ────────────────────────────────────────────────────────────────────

type BaseV7Authorization = {
  validAfter: string
  validBefore: string
  nonce: string
}

type BaseV7TypedDataInput = {
  payerAddress: string
  value: string | bigint
  validAfter: string | number | bigint
  validBefore: string | number | bigint
  nonce: string
}

type BaseV7PaymentContext = {
  paymentId: string
  payerAddress: string
  merchantWallet: string
  treasuryWallet: string
  merchantAmount: bigint
  feeAmount: bigint
  totalAmount: bigint
  splitContract: string
}

export type BaseV7UnavailableResponse = {
  ok: false
  unavailable: true
  code: "BASE_USDC_TEMPORARILY_UNAVAILABLE"
  message: string
}

export type BaseV7RelayResponse =
  | { ok: true; status: "submitted"; txHash: string }
  | BaseV7UnavailableResponse

export type BaseV7AllowanceCheckResult =
  | { ok: true; allowance: string; required: string; sufficient: boolean }
  | BaseV7UnavailableResponse

export type BaseV7AllowancePaymentResult =
  | {
      ok: true
      paymentId: string
      sufficient: boolean
      currentAllowance: string
      requiredAmount: string
      approveTx: { to: string; data: string; value: string; chainId: number } | null
      paymentTx: { to: string; data: string; value: string; chainId: number }
    }
  | BaseV7UnavailableResponse

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unavailable(): BaseV7UnavailableResponse {
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

function normalizeAuthorization(input: BaseV7Authorization): BaseV7Authorization {
  const validAfter = String(input.validAfter ?? "").trim()
  const validBefore = String(input.validBefore ?? "").trim()
  const nonce = String(input.nonce || "").trim()

  if (!/^\d+$/.test(validAfter) || !/^\d+$/.test(validBefore)) {
    throw new Error("Invalid Base V7 authorization validity window")
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(nonce)) {
    throw new Error("Invalid Base V7 authorization nonce")
  }
  return { validAfter, validBefore, nonce }
}

function isSameAddress(left: string, right: string): boolean {
  return requireEvmAddress("address", left) === requireEvmAddress("address", right)
}

// ─── Payment context loader ───────────────────────────────────────────────────

async function loadV7PaymentContext(input: {
  paymentId: string
  payerAddress: string
  allowTerminal: boolean
}): Promise<BaseV7PaymentContext> {
  const paymentId = String(input.paymentId || "").trim()
  if (!paymentId) throw new Error("Missing paymentId")

  const payerAddress = requireEvmAddress("payerAddress", input.payerAddress)
  const payment = await getPaymentById(paymentId)
  if (!payment) throw new Error("Payment not found")

  const status = String(payment.status || "").toUpperCase()
  if (!input.allowTerminal && TERMINAL_PAYMENT_STATUSES.has(status)) {
    throw new Error("Payment is already terminal")
  }
  if (!["CREATED", "PENDING", "PROCESSING"].includes(status)) {
    throw new Error("Payment is not active")
  }

  if (String(payment.network || "").toLowerCase().trim() !== "base") {
    throw new Error("Base V7 is only available for Base payments")
  }

  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
  if (!split) throw new Error("Payment split metadata is missing")

  if (String(split.asset || "").toUpperCase() !== "USDC") {
    throw new Error("Payment is not a Base USDC payment")
  }

  const v7Contract = getBaseV7Contract()
  if (split.splitContract && !isSameAddress(String(split.splitContract), v7Contract)) {
    throw new Error("Payment split contract does not match Base V7 contract")
  }

  const merchantWallet = requireEvmAddress("merchantWallet", String(split.merchantWallet || ""))
  const treasuryWallet = requireEvmAddress(
    "PINETREE_TREASURY_WALLET_BASE",
    getPineTreeTreasuryWallet("base")
  )
  const splitTreasuryWallet = requireEvmAddress("pinetreeWallet", String(split.pinetreeWallet || ""))

  if (treasuryWallet !== splitTreasuryWallet) {
    throw new Error("Payment treasury does not match PINETREE_TREASURY_WALLET_BASE")
  }

  const merchantAmount = requireAtomicAmount(
    "merchantNativeAmountAtomic",
    split.merchantNativeAmountAtomic
  )
  const feeAmount = requireAtomicAmount("feeNativeAmountAtomic", split.feeNativeAmountAtomic)

  return {
    paymentId: payment.id,
    payerAddress,
    merchantWallet,
    treasuryWallet,
    merchantAmount,
    feeAmount,
    totalAmount: merchantAmount + feeAmount,
    splitContract: requireEvmAddress("PINETREE_BASE_V7_CONTRACT", v7Contract)
  }
}

// ─── Typed data builder ───────────────────────────────────────────────────────

export function buildBaseV7TypedData(input: BaseV7TypedDataInput) {
  const authorization = normalizeAuthorization({
    validAfter: String(input.validAfter),
    validBefore: String(input.validBefore),
    nonce: input.nonce
  })
  const value = String(input.value)
  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
    throw new Error("Invalid Base V7 authorization value")
  }

  return {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: BASE_CHAIN_ID,
      verifyingContract: getBaseV7UsdcToken()
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
      to: getBaseV7Contract(),
      value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce
    }
  }
}

// ─── Availability check ───────────────────────────────────────────────────────

export async function getBaseV7Availability(): Promise<BaseV7UnavailableResponse | { ok: true }> {
  try {
    getBaseV7Contract()
    getBaseV7UsdcToken()
    getBaseV7Relayer()
    getBaseV7GasCap()
    getBaseV7AuthValiditySeconds()
    getPineTreeTreasuryWallet("base")
    getRpcUrl("base")
    return { ok: true }
  } catch {
    return unavailable()
  }
}

// ─── Prepare authorization ────────────────────────────────────────────────────

export async function prepareBaseV7Authorization(input: {
  paymentId: string
  payerAddress: string
}) {
  console.info("[BASE V7] prepare-authorization entry", {
    paymentId: input.paymentId
  })

  const availability = await getBaseV7Availability()
  if (!availability.ok) {
    console.warn("[BASE V7] prepare-authorization config unavailable", {
      paymentId: input.paymentId,
      code: availability.code
    })
    return availability
  }

  let context: BaseV7PaymentContext
  try {
    context = await loadV7PaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress,
      allowTerminal: false
    })
  } catch (ctxErr) {
    const ctxMsg = ctxErr instanceof Error ? ctxErr.message : String(ctxErr)
    console.error("[BASE V7] prepare-authorization context load failed", {
      paymentId: input.paymentId,
      error: ctxMsg
    })
    throw ctxErr
  }

  const v7Contract = getBaseV7Contract()
  const usdcTokenAddress = getBaseV7UsdcToken()
  const now = Math.floor(Date.now() / 1000)
  const authorization: BaseV7Authorization = {
    validAfter: "0",
    validBefore: String(now + getBaseV7AuthValiditySeconds()),
    nonce: hexlify(randomBytes(32))
  }
  const typedData = buildBaseV7TypedData({
    payerAddress: context.payerAddress,
    value: context.totalAmount,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce
  })

  console.info("[BASE V7] prepare-authorization success", {
    paymentId: context.paymentId,
    splitContract: v7Contract,
    usdcTokenAddress,
    validBefore: authorization.validBefore
  })

  return {
    ok: true,
    paymentId: context.paymentId,
    typedData,
    authorization,
    value: context.totalAmount.toString()
  }
}

// ─── Relay payment (EIP-3009 path) ───────────────────────────────────────────

export async function relayBaseV7Payment(input: {
  paymentId: string
  payerAddress: string
  authorization: BaseV7Authorization
  signature: string
}): Promise<BaseV7RelayResponse> {
  console.info("[BASE V7] relay entry", {
    paymentId: input.paymentId
  })

  const availability = await getBaseV7Availability()
  if (!availability.ok) {
    console.warn("[BASE V7] relay config unavailable", {
      paymentId: input.paymentId,
      code: availability.code
    })
    return availability
  }

  const existingTransaction = await getTransactionByPaymentId(input.paymentId)
  const existingTxHash = String(existingTransaction?.provider_transaction_id || "").trim()
  if (/^0x[a-fA-F0-9]{64}$/.test(existingTxHash)) {
    console.info("[BASE V7] relay idempotent — txHash already exists", {
      paymentId: input.paymentId,
      txHash: existingTxHash
    })
    return { ok: true, status: "submitted", txHash: existingTxHash }
  }

  const context = await loadV7PaymentContext({
    paymentId: input.paymentId,
    payerAddress: input.payerAddress,
    allowTerminal: false
  })
  const authorization = normalizeAuthorization(input.authorization)

  const nowSec = Math.floor(Date.now() / 1000)
  if (BigInt(authorization.validBefore) <= BigInt(nowSec)) {
    console.warn("[BASE V7] relay authorization expired", {
      paymentId: input.paymentId,
      validBefore: authorization.validBefore,
      now: nowSec
    })
    throw new Error("USDC authorization has expired. Please authorize again.")
  }

  const typedData = buildBaseV7TypedData({
    payerAddress: context.payerAddress,
    value: context.totalAmount,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce
  })
  const recovered = getAddress(
    verifyTypedData(typedData.domain, typedData.types, typedData.message, input.signature)
  )

  if (recovered !== context.payerAddress) {
    console.error("[BASE V7] relay signature mismatch", {
      paymentId: input.paymentId,
      recovered,
      expected: context.payerAddress
    })
    throw new Error("Base V7 authorization signature does not match payer")
  }

  const signature = Signature.from(input.signature)
  const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
  const { address: configuredRelayerAddress, privateKey } = getBaseV7Relayer()
  const relayer = new Wallet(privateKey, provider)

  if (getAddress(relayer.address) !== getAddress(configuredRelayerAddress)) {
    console.error("[BASE V7] relay address mismatch", {
      paymentId: input.paymentId,
      configuredRelayerAddress,
      derivedRelayerAddress: relayer.address
    })
    return unavailable()
  }

  const contract = new Contract(context.splitContract, V7_ABI, relayer)

  const [isRelayerAllowed, isPaymentRefUsed, contractTreasury] = await Promise.all([
    contract.relayers(relayer.address) as Promise<boolean>,
    contract.isPaymentRefUsed(context.paymentId) as Promise<boolean>,
    contract.pineTreeTreasury() as Promise<string>
  ])

  console.info("[BASE V7] relay contract checks", {
    paymentId: input.paymentId,
    splitContract: context.splitContract,
    relayerAddress: relayer.address,
    isRelayerAllowed,
    isPaymentRefUsed,
    contractTreasuryMatchesConfig:
      getAddress(contractTreasury) === getAddress(context.treasuryWallet)
  })

  if (!isRelayerAllowed) {
    console.error("[BASE V7] relay not allowlisted", {
      paymentId: input.paymentId,
      relayerAddress: relayer.address,
      splitContract: context.splitContract
    })
    return unavailable()
  }

  if (isPaymentRefUsed) {
    throw new Error("Base V7 payment reference has already been used on-chain")
  }

  if (getAddress(contractTreasury) !== getAddress(context.treasuryWallet)) {
    console.error("[BASE V7] relay treasury mismatch", {
      paymentId: input.paymentId,
      contractTreasury: getAddress(contractTreasury),
      configuredTreasury: context.treasuryWallet
    })
    return unavailable()
  }

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
  const signatureArgs = { v: signature.v, r: signature.r, s: signature.s }

  const estimatedGas = await contract.payUsdcWithAuthorization.estimateGas(
    paymentArgs,
    authorizationArgs,
    signatureArgs
  )
  const feeData = await provider.getFeeData()
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice
  if (!gasPrice) {
    console.warn("[BASE V7] relay no gas price available", { paymentId: input.paymentId })
    return unavailable()
  }

  const gasCostWei = estimatedGas * gasPrice
  const prices = await getMarketPricesUSD()
  const gasCostUsd = Number(formatEther(gasCostWei)) * prices.ETH
  const { maxGasUsd } = getBaseV7GasCap()
  const relayerBalance = await provider.getBalance(relayer.address)

  console.info("[BASE V7] relay gas check", {
    paymentId: input.paymentId,
    estimatedGas: estimatedGas.toString(),
    gasCostUsd: Number.isFinite(gasCostUsd) ? gasCostUsd.toFixed(6) : "NaN",
    maxGasUsd,
    withinCap: Number.isFinite(gasCostUsd) && gasCostUsd <= maxGasUsd
  })

  if (!Number.isFinite(gasCostUsd) || gasCostUsd > maxGasUsd) {
    console.warn("[BASE V7] relay gas cap exceeded", {
      paymentId: input.paymentId,
      gasCostUsd,
      maxGasUsd
    })
    return unavailable()
  }

  if (relayerBalance < gasCostWei) {
    console.warn("[BASE V7] relay insufficient ETH balance", {
      paymentId: input.paymentId,
      gasCostWei: gasCostWei.toString(),
      relayerBalanceWei: relayerBalance.toString()
    })
    return unavailable()
  }

  console.info("[BASE V7] relay submitting payUsdcWithAuthorization", {
    paymentId: input.paymentId,
    splitContract: context.splitContract,
    relayerAddress: relayer.address
  })

  const tx = await contract.payUsdcWithAuthorization(
    paymentArgs,
    authorizationArgs,
    signatureArgs
  )
  const txHash = String(tx.hash || "")
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error("Base V7 relayer did not return a transaction hash")
  }

  console.info("[BASE V7] relay tx submitted", { paymentId: input.paymentId, txHash })

  if (existingTransaction?.id) {
    await updateTransactionProviderReference(existingTransaction.id, txHash)
  }

  // Return immediately — the txHash is stored in the DB and the frontend /detect
  // call + scheduled payment watcher will confirm the receipt asynchronously.
  // Blocking here for a receipt (up to 90s) causes serverless function timeouts
  // which prevent the frontend from ever receiving the txHash.
  console.info("[BASE V7] relay tx hash stored — returning to frontend for detection", {
    paymentId: input.paymentId,
    txHash
  })

  return { ok: true, status: "submitted", txHash }
}

// ─── Allowance check ──────────────────────────────────────────────────────────

export async function checkBaseV7Allowance(input: {
  paymentId: string
  payerAddress: string
}): Promise<BaseV7AllowanceCheckResult> {
  try {
    const context = await loadV7PaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress,
      allowTerminal: false
    })
    const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
    const usdcContract = new Contract(getBaseV7UsdcToken(), USDC_ABI, provider)
    const rawAllowance = (await usdcContract.allowance(
      context.payerAddress,
      context.splitContract
    )) as bigint

    const allowance = rawAllowance.toString()
    const required = context.totalAmount.toString()
    const sufficient = rawAllowance >= context.totalAmount

    console.info("[BASE V7] allowance check", {
      paymentId: context.paymentId,
      allowance,
      required,
      sufficient
    })
    return { ok: true, allowance, required, sufficient }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[BASE V7] allowance check failed", {
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }
}

// ─── Build allowance-path transactions ───────────────────────────────────────

export async function buildBaseV7AllowancePayment(input: {
  paymentId: string
  payerAddress: string
}): Promise<BaseV7AllowancePaymentResult> {
  let context: BaseV7PaymentContext
  try {
    context = await loadV7PaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress,
      allowTerminal: false
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[BASE V7] build-allowance-payment context error", {
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }

  try {
    const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
    const usdcContract = new Contract(getBaseV7UsdcToken(), USDC_ABI, provider)
    const rawAllowance = (await usdcContract.allowance(
      context.payerAddress,
      context.splitContract
    )) as bigint

    const sufficient = rawAllowance >= context.totalAmount

    const approveTx = sufficient
      ? null
      : {
          to: getBaseV7UsdcToken(),
          data: usdcIface.encodeFunctionData("approve", [
            context.splitContract,
            context.totalAmount
          ]),
          value: "0x0",
          chainId: BASE_CHAIN_ID
        }

    const paymentTx = {
      to: context.splitContract,
      data: v7Iface.encodeFunctionData("payUsdcWithAllowance", [
        context.merchantWallet,
        context.treasuryWallet,
        context.merchantAmount,
        context.feeAmount,
        context.paymentId
      ]),
      value: "0x0",
      chainId: BASE_CHAIN_ID
    }

    console.info("[BASE V7] build-allowance-payment ready", {
      paymentId: context.paymentId,
      sufficient,
      currentAllowance: rawAllowance.toString(),
      required: context.totalAmount.toString()
    })

    return {
      ok: true,
      paymentId: context.paymentId,
      sufficient,
      currentAllowance: rawAllowance.toString(),
      requiredAmount: context.totalAmount.toString(),
      approveTx,
      paymentTx
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[BASE V7] build-allowance-payment failed", {
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }
}
