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
  getBaseV6AuthValiditySeconds,
  getBaseV6Contract,
  getBaseV6GasCap,
  getBaseV6Relayer,
  getBaseV6UsdcToken,
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

const V6_ABI = [
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

const v6Iface = new Interface([
  "function payUsdcWithAllowance(address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef)"
])

// ─── Types ────────────────────────────────────────────────────────────────────

type BaseV6Authorization = {
  validAfter: string
  validBefore: string
  nonce: string
}

type BaseV6TypedDataInput = {
  payerAddress: string
  value: string | bigint
  validAfter: string | number | bigint
  validBefore: string | number | bigint
  nonce: string
}

type BaseV6PaymentContext = {
  paymentId: string
  payerAddress: string
  merchantWallet: string
  treasuryWallet: string
  merchantAmount: bigint
  feeAmount: bigint
  totalAmount: bigint
  splitContract: string
}

export type BaseV6UnavailableResponse = {
  ok: false
  unavailable: true
  code: "BASE_USDC_TEMPORARILY_UNAVAILABLE"
  message: string
}

export type BaseV6RelayResponse =
  | { ok: true; status: "submitted"; txHash: string }
  | BaseV6UnavailableResponse

export type BaseV6AllowanceCheckResult =
  | { ok: true; allowance: string; required: string; sufficient: boolean }
  | BaseV6UnavailableResponse

export type BaseV6AllowancePaymentResult =
  | {
      ok: true
      paymentId: string
      sufficient: boolean
      currentAllowance: string
      requiredAmount: string
      approveTx: { to: string; data: string; value: string; chainId: number } | null
      paymentTx: { to: string; data: string; value: string; chainId: number }
    }
  | BaseV6UnavailableResponse

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unavailable(): BaseV6UnavailableResponse {
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

function normalizeAuthorization(input: BaseV6Authorization): BaseV6Authorization {
  const validAfter = String(input.validAfter ?? "").trim()
  const validBefore = String(input.validBefore ?? "").trim()
  const nonce = String(input.nonce || "").trim()

  if (!/^\d+$/.test(validAfter) || !/^\d+$/.test(validBefore)) {
    throw new Error("Invalid Base V6 authorization validity window")
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(nonce)) {
    throw new Error("Invalid Base V6 authorization nonce")
  }
  return { validAfter, validBefore, nonce }
}

function isSameAddress(left: string, right: string): boolean {
  return requireEvmAddress("address", left) === requireEvmAddress("address", right)
}

// ─── Payment context loader ───────────────────────────────────────────────────

async function loadV6PaymentContext(input: {
  paymentId: string
  payerAddress: string
  allowTerminal: boolean
}): Promise<BaseV6PaymentContext> {
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
    throw new Error("Base V6 is only available for Base payments")
  }

  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
  if (!split) throw new Error("Payment split metadata is missing")

  if (String(split.asset || "").toUpperCase() !== "USDC") {
    throw new Error("Payment is not a Base USDC payment")
  }

  const v6Contract = getBaseV6Contract()
  if (split.splitContract && !isSameAddress(String(split.splitContract), v6Contract)) {
    throw new Error("Payment split contract does not match Base V6 contract")
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
    splitContract: requireEvmAddress("PINETREE_BASE_V6_CONTRACT", v6Contract)
  }
}

// ─── Typed data builder ───────────────────────────────────────────────────────

export function buildBaseV6TypedData(input: BaseV6TypedDataInput) {
  const authorization = normalizeAuthorization({
    validAfter: String(input.validAfter),
    validBefore: String(input.validBefore),
    nonce: input.nonce
  })
  const value = String(input.value)
  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
    throw new Error("Invalid Base V6 authorization value")
  }

  return {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: BASE_CHAIN_ID,
      verifyingContract: getBaseV6UsdcToken()
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
      to: getBaseV6Contract(),
      value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce
    }
  }
}

// ─── Availability check ───────────────────────────────────────────────────────

export async function getBaseV6Availability(): Promise<BaseV6UnavailableResponse | { ok: true }> {
  try {
    getBaseV6Contract()
    getBaseV6UsdcToken()
    getBaseV6Relayer()
    getBaseV6GasCap()
    getBaseV6AuthValiditySeconds()
    getPineTreeTreasuryWallet("base")
    getRpcUrl("base")
    return { ok: true }
  } catch {
    return unavailable()
  }
}

// ─── Prepare authorization ────────────────────────────────────────────────────

export async function prepareBaseV6Authorization(input: {
  paymentId: string
  payerAddress: string
}) {
  console.info("[BASE V6] prepare-authorization entry", {
    paymentId: input.paymentId,
    payerAddress: input.payerAddress
  })

  const availability = await getBaseV6Availability()
  if (!availability.ok) {
    console.warn("[BASE V6] prepare-authorization config unavailable", {
      paymentId: input.paymentId,
      code: availability.code
    })
    return availability
  }

  let context: BaseV6PaymentContext
  try {
    context = await loadV6PaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress,
      allowTerminal: false
    })
  } catch (ctxErr) {
    const ctxMsg = ctxErr instanceof Error ? ctxErr.message : String(ctxErr)
    console.error("[BASE V6] prepare-authorization context load failed", {
      paymentId: input.paymentId,
      error: ctxMsg
    })
    throw ctxErr
  }

  const v6Contract = getBaseV6Contract()
  const usdcTokenAddress = getBaseV6UsdcToken()
  const now = Math.floor(Date.now() / 1000)
  const authorization: BaseV6Authorization = {
    validAfter: "0",
    validBefore: String(now + getBaseV6AuthValiditySeconds()),
    nonce: hexlify(randomBytes(32))
  }
  const typedData = buildBaseV6TypedData({
    payerAddress: context.payerAddress,
    value: context.totalAmount,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce
  })

  console.info("[BASE V6] prepare-authorization success", {
    paymentId: context.paymentId,
    splitContract: v6Contract,
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

export async function relayBaseV6Payment(input: {
  paymentId: string
  payerAddress: string
  authorization: BaseV6Authorization
  signature: string
}): Promise<BaseV6RelayResponse> {
  console.info("[BASE V6] relay entry", {
    paymentId: input.paymentId,
    payerAddress: input.payerAddress
  })

  const availability = await getBaseV6Availability()
  if (!availability.ok) {
    console.warn("[BASE V6] relay config unavailable", {
      paymentId: input.paymentId,
      code: availability.code
    })
    return availability
  }

  const existingTransaction = await getTransactionByPaymentId(input.paymentId)
  const existingTxHash = String(existingTransaction?.provider_transaction_id || "").trim()
  if (/^0x[a-fA-F0-9]{64}$/.test(existingTxHash)) {
    console.info("[BASE V6] relay idempotent — txHash already exists", {
      paymentId: input.paymentId,
      txHash: existingTxHash
    })
    return { ok: true, status: "submitted", txHash: existingTxHash }
  }

  const context = await loadV6PaymentContext({
    paymentId: input.paymentId,
    payerAddress: input.payerAddress,
    allowTerminal: false
  })
  const authorization = normalizeAuthorization(input.authorization)

  const nowSec = Math.floor(Date.now() / 1000)
  if (BigInt(authorization.validBefore) <= BigInt(nowSec)) {
    console.warn("[BASE V6] relay authorization expired", {
      paymentId: input.paymentId,
      validBefore: authorization.validBefore,
      now: nowSec
    })
    throw new Error("USDC authorization has expired. Please authorize again.")
  }

  const typedData = buildBaseV6TypedData({
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
    console.error("[BASE V6] relay signature mismatch", {
      paymentId: input.paymentId,
      recovered,
      expected: context.payerAddress
    })
    throw new Error("Base V6 authorization signature does not match payer")
  }

  const signature = Signature.from(input.signature)
  const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
  const { address: configuredRelayerAddress, privateKey } = getBaseV6Relayer()
  const relayer = new Wallet(privateKey, provider)

  if (getAddress(relayer.address) !== getAddress(configuredRelayerAddress)) {
    console.error("[BASE V6] relay address mismatch", {
      paymentId: input.paymentId,
      configuredRelayerAddress,
      derivedRelayerAddress: relayer.address
    })
    return unavailable()
  }

  const contract = new Contract(context.splitContract, V6_ABI, relayer)

  const [isRelayerAllowed, isPaymentRefUsed, contractTreasury] = await Promise.all([
    contract.relayers(relayer.address) as Promise<boolean>,
    contract.isPaymentRefUsed(context.paymentId) as Promise<boolean>,
    contract.pineTreeTreasury() as Promise<string>
  ])

  console.info("[BASE V6] relay contract checks", {
    paymentId: input.paymentId,
    splitContract: context.splitContract,
    relayerAddress: relayer.address,
    isRelayerAllowed,
    isPaymentRefUsed,
    contractTreasuryMatchesConfig:
      getAddress(contractTreasury) === getAddress(context.treasuryWallet)
  })

  if (!isRelayerAllowed) {
    console.error("[BASE V6] relay not allowlisted", {
      paymentId: input.paymentId,
      relayerAddress: relayer.address,
      splitContract: context.splitContract
    })
    return unavailable()
  }

  if (isPaymentRefUsed) {
    throw new Error("Base V6 payment reference has already been used on-chain")
  }

  if (getAddress(contractTreasury) !== getAddress(context.treasuryWallet)) {
    console.error("[BASE V6] relay treasury mismatch", {
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
    console.warn("[BASE V6] relay no gas price available", { paymentId: input.paymentId })
    return unavailable()
  }

  const gasCostWei = estimatedGas * gasPrice
  const prices = await getMarketPricesUSD()
  const gasCostUsd = Number(formatEther(gasCostWei)) * prices.ETH
  const { maxGasUsd } = getBaseV6GasCap()
  const relayerBalance = await provider.getBalance(relayer.address)

  console.info("[BASE V6] relay gas check", {
    paymentId: input.paymentId,
    estimatedGas: estimatedGas.toString(),
    gasCostUsd: Number.isFinite(gasCostUsd) ? gasCostUsd.toFixed(6) : "NaN",
    maxGasUsd,
    withinCap: Number.isFinite(gasCostUsd) && gasCostUsd <= maxGasUsd
  })

  if (!Number.isFinite(gasCostUsd) || gasCostUsd > maxGasUsd) {
    console.warn("[BASE V6] relay gas cap exceeded", {
      paymentId: input.paymentId,
      gasCostUsd,
      maxGasUsd
    })
    return unavailable()
  }

  if (relayerBalance < gasCostWei) {
    console.warn("[BASE V6] relay insufficient ETH balance", {
      paymentId: input.paymentId,
      gasCostWei: gasCostWei.toString(),
      relayerBalanceWei: relayerBalance.toString()
    })
    return unavailable()
  }

  console.info("[BASE V6] relay submitting payUsdcWithAuthorization", {
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
    throw new Error("Base V6 relayer did not return a transaction hash")
  }

  console.info("[BASE V6] relay tx submitted", { paymentId: input.paymentId, txHash })

  if (existingTransaction?.id) {
    await updateTransactionProviderReference(existingTransaction.id, txHash)
  }

  try {
    const receipt = await provider.waitForTransaction(txHash, 1, 90_000)
    if (receipt) {
      console.info("[BASE V6] relay receipt mined", {
        paymentId: input.paymentId,
        txHash,
        receiptStatus: receipt.status !== undefined ? String(receipt.status) : "unknown"
      })
      const { runPaymentWatcher } = await import("./checkPaymentOnce")
      try {
        await runPaymentWatcher(input.paymentId, { txHash })
      } catch (watcherErr) {
        console.error("[BASE V6] relay watcher error", {
          paymentId: input.paymentId,
          txHash,
          error: watcherErr instanceof Error ? watcherErr.message : String(watcherErr)
        })
      }
    }
  } catch (waitErr) {
    console.warn("[BASE V6] relay wait-for-receipt timeout — cron will detect", {
      paymentId: input.paymentId,
      txHash,
      error: waitErr instanceof Error ? waitErr.message : String(waitErr)
    })
  }

  return { ok: true, status: "submitted", txHash }
}

// ─── Allowance check ──────────────────────────────────────────────────────────

export async function checkBaseV6Allowance(input: {
  paymentId: string
  payerAddress: string
}): Promise<BaseV6AllowanceCheckResult> {
  try {
    const context = await loadV6PaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress,
      allowTerminal: false
    })
    const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
    const usdcContract = new Contract(getBaseV6UsdcToken(), USDC_ABI, provider)
    const rawAllowance = (await usdcContract.allowance(
      context.payerAddress,
      context.splitContract
    )) as bigint

    const allowance = rawAllowance.toString()
    const required = context.totalAmount.toString()
    const sufficient = rawAllowance >= context.totalAmount

    console.info("[BASE V6] allowance check", {
      paymentId: context.paymentId,
      allowance,
      required,
      sufficient
    })
    return { ok: true, allowance, required, sufficient }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[BASE V6] allowance check failed", {
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }
}

// ─── Build allowance-path transactions ───────────────────────────────────────

export async function buildBaseV6AllowancePayment(input: {
  paymentId: string
  payerAddress: string
}): Promise<BaseV6AllowancePaymentResult> {
  let context: BaseV6PaymentContext
  try {
    context = await loadV6PaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress,
      allowTerminal: false
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[BASE V6] build-allowance-payment context error", {
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }

  try {
    const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
    const usdcContract = new Contract(getBaseV6UsdcToken(), USDC_ABI, provider)
    const rawAllowance = (await usdcContract.allowance(
      context.payerAddress,
      context.splitContract
    )) as bigint

    const sufficient = rawAllowance >= context.totalAmount

    const approveTx = sufficient
      ? null
      : {
          to: getBaseV6UsdcToken(),
          data: usdcIface.encodeFunctionData("approve", [
            context.splitContract,
            context.totalAmount
          ]),
          value: "0x0",
          chainId: BASE_CHAIN_ID
        }

    const paymentTx = {
      to: context.splitContract,
      data: v6Iface.encodeFunctionData("payUsdcWithAllowance", [
        context.merchantWallet,
        context.treasuryWallet,
        context.merchantAmount,
        context.feeAmount,
        context.paymentId
      ]),
      value: "0x0",
      chainId: BASE_CHAIN_ID
    }

    console.info("[BASE V6] build-allowance-payment ready", {
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
    console.error("[BASE V6] build-allowance-payment failed", {
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }
}
