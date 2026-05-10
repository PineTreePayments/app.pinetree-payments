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
  getBaseUsdcAuthValiditySeconds,
  getBaseUsdcGasCap,
  getBaseUsdcRelayer,
  getBaseUsdcTokenAddress,
  getBaseV5SplitContract,
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

const V5_ABI = [
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

const v5Iface = new Interface([
  "function payUsdcWithAllowance(address merchant,address treasury,uint256 merchantAmount,uint256 feeAmount,string paymentRef)"
])

// ─── Types ────────────────────────────────────────────────────────────────────

type BaseUsdcV5Authorization = {
  validAfter: string
  validBefore: string
  nonce: string
}

type BaseUsdcV5TypedDataInput = {
  payerAddress: string
  value: string | bigint
  validAfter: string | number | bigint
  validBefore: string | number | bigint
  nonce: string
}

type BaseUsdcV5PaymentContext = {
  paymentId: string
  payerAddress: string
  merchantWallet: string
  treasuryWallet: string
  merchantAmount: bigint
  feeAmount: bigint
  totalAmount: bigint
  splitContract: string
}

export type BaseUsdcV5UnavailableResponse = {
  ok: false
  unavailable: true
  code: "BASE_USDC_TEMPORARILY_UNAVAILABLE"
  message: string
}

export type BaseUsdcV5RelayResponse =
  | { ok: true; status: "submitted"; txHash: string }
  | BaseUsdcV5UnavailableResponse

export type BaseUsdcV5AllowanceCheckResult =
  | { ok: true; allowance: string; required: string; sufficient: boolean }
  | BaseUsdcV5UnavailableResponse

export type BaseUsdcV5AllowancePaymentResult =
  | {
      ok: true
      paymentId: string
      sufficient: boolean
      currentAllowance: string
      requiredAmount: string
      approveTx: { to: string; data: string; value: string; chainId: number } | null
      paymentTx: { to: string; data: string; value: string; chainId: number }
    }
  | BaseUsdcV5UnavailableResponse

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unavailable(): BaseUsdcV5UnavailableResponse {
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

function normalizeAuthorization(input: BaseUsdcV5Authorization): BaseUsdcV5Authorization {
  const validAfter = String(input.validAfter ?? "").trim()
  const validBefore = String(input.validBefore ?? "").trim()
  const nonce = String(input.nonce || "").trim()

  if (!/^\d+$/.test(validAfter) || !/^\d+$/.test(validBefore)) {
    throw new Error("Invalid Base USDC V5 authorization validity window")
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(nonce)) {
    throw new Error("Invalid Base USDC V5 authorization nonce")
  }

  return { validAfter, validBefore, nonce }
}

function isSameAddress(left: string, right: string): boolean {
  return requireEvmAddress("address", left) === requireEvmAddress("address", right)
}

// ─── Payment context loader ───────────────────────────────────────────────────

async function loadValidatedPaymentContext(input: {
  paymentId: string
  payerAddress: string
  allowTerminal: boolean
}): Promise<BaseUsdcV5PaymentContext> {
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
    throw new Error("Base USDC V5 is only available for Base payments")
  }

  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
  if (!split) throw new Error("Payment split metadata is missing")

  if (String(split.asset || "").toUpperCase() !== "USDC") {
    throw new Error("Payment is not a Base USDC payment")
  }

  if (split.baseUsdcStrategy !== "v5_eip3009_relayer") {
    throw new Error("Payment is not configured for Base USDC V5 relayer")
  }

  const v5Contract = getBaseV5SplitContract()
  if (!isSameAddress(String(split.splitContract || ""), v5Contract)) {
    throw new Error("Payment split contract does not match Base V5 contract")
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
    splitContract: requireEvmAddress("PINETREE_BASE_SPLIT_V5_CONTRACT", v5Contract)
  }
}

// Lighter context loader for allowance path — does not require v5_eip3009_relayer strategy.
// The allowance path is valid for any active V5 USDC payment.
async function loadAllowancePaymentContext(input: {
  paymentId: string
  payerAddress: string
}): Promise<BaseUsdcV5PaymentContext> {
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
    throw new Error("Base USDC V5 is only available for Base payments")
  }

  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
  if (!split) throw new Error("Payment split metadata is missing")

  if (String(split.asset || "").toUpperCase() !== "USDC") {
    throw new Error("Payment is not a Base USDC payment")
  }

  const v5Contract = getBaseV5SplitContract()

  const merchantWallet = requireEvmAddress("merchantWallet", String(split.merchantWallet || ""))
  const treasuryWallet = requireEvmAddress("PINETREE_TREASURY_WALLET_BASE", getPineTreeTreasuryWallet("base"))
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
    splitContract: requireEvmAddress("PINETREE_BASE_SPLIT_V5_CONTRACT", v5Contract)
  }
}

// ─── Typed data builder ───────────────────────────────────────────────────────

export function buildBaseUsdcV5TypedData(input: BaseUsdcV5TypedDataInput) {
  const authorization = normalizeAuthorization({
    validAfter: String(input.validAfter),
    validBefore: String(input.validBefore),
    nonce: input.nonce
  })
  const value = String(input.value)
  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
    throw new Error("Invalid Base USDC V5 authorization value")
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
      to: getBaseV5SplitContract(),
      value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce
    }
  }
}

// ─── Availability check ───────────────────────────────────────────────────────

export async function getBaseUsdcV5Availability(): Promise<BaseUsdcV5UnavailableResponse | { ok: true }> {
  try {
    getBaseV5SplitContract()
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

// ─── Prepare authorization ────────────────────────────────────────────────────

export async function prepareBaseUsdcV5Authorization(input: {
  paymentId: string
  payerAddress: string
}) {
  console.info("[PineTreeBaseTrace] v5 prepare-authorization engine called", {
    step: "v5-prepare-entry",
    paymentId: input.paymentId,
    payerAddress: input.payerAddress
  })

  const availability = await getBaseUsdcV5Availability()
  if (!availability.ok) {
    console.warn("[PineTreeBaseTrace] v5 prepare-authorization config unavailable", {
      step: "v5-prepare-unavailable",
      paymentId: input.paymentId,
      code: availability.code
    })
    return availability
  }

  let context: BaseUsdcV5PaymentContext
  try {
    context = await loadValidatedPaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress,
      allowTerminal: false
    })
  } catch (ctxErr) {
    const ctxMsg = ctxErr instanceof Error ? ctxErr.message : String(ctxErr)
    console.error("[PineTreeBaseTrace] v5 prepare-authorization context load failed", {
      step: "v5-prepare-context-error",
      paymentId: input.paymentId,
      error: ctxMsg
    })
    throw ctxErr
  }

  const v5Contract = getBaseV5SplitContract()
  const usdcTokenAddress = getBaseUsdcTokenAddress()

  const now = Math.floor(Date.now() / 1000)
  const authorization: BaseUsdcV5Authorization = {
    validAfter: "0",
    validBefore: String(now + getBaseUsdcAuthValiditySeconds()),
    nonce: hexlify(randomBytes(32))
  }
  const typedData = buildBaseUsdcV5TypedData({
    payerAddress: context.payerAddress,
    value: context.totalAmount,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce
  })

  console.info("[PineTreeBaseTrace] v5 prepare-authorization typed-data prepared", {
    step: "v5-prepare-success",
    paymentId: context.paymentId,
    baseUsdcStrategy: "v5_eip3009_relayer",
    splitContract: v5Contract,
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

// ─── Relay payment (authorization path) ──────────────────────────────────────

export async function relayBaseUsdcV5Payment(input: {
  paymentId: string
  payerAddress: string
  authorization: BaseUsdcV5Authorization
  signature: string
}): Promise<BaseUsdcV5RelayResponse> {
  console.info("[PineTreeBaseTrace] v5 relayer called", {
    step: "v5-relay-entry",
    paymentId: input.paymentId,
    payerAddress: input.payerAddress
  })

  const availability = await getBaseUsdcV5Availability()
  if (!availability.ok) {
    console.warn("[PineTreeBaseTrace] v5 relayer config unavailable", {
      step: "v5-relay-config-unavailable",
      paymentId: input.paymentId,
      code: availability.code
    })
    return availability
  }

  const existingTransaction = await getTransactionByPaymentId(input.paymentId)
  const existingTxHash = String(existingTransaction?.provider_transaction_id || "").trim()
  if (/^0x[a-fA-F0-9]{64}$/.test(existingTxHash)) {
    console.info("[PineTreeBaseTrace] v5 relayer idempotent — txHash already exists", {
      step: "v5-relay-idempotent",
      paymentId: input.paymentId,
      txHash: existingTxHash
    })
    return { ok: true, status: "submitted", txHash: existingTxHash }
  }

  const context = await loadValidatedPaymentContext({
    paymentId: input.paymentId,
    payerAddress: input.payerAddress,
    allowTerminal: false
  })
  const authorization = normalizeAuthorization(input.authorization)
  const typedData = buildBaseUsdcV5TypedData({
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
    console.error("[PineTreeBaseTrace] v5 relayer signature mismatch", {
      step: "v5-relay-sig-mismatch",
      paymentId: input.paymentId,
      recovered,
      expected: context.payerAddress
    })
    throw new Error("Base USDC V5 authorization signature does not match payer")
  }

  const signature = Signature.from(input.signature)
  const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
  const { address: configuredRelayerAddress, privateKey } = getBaseUsdcRelayer()
  const relayer = new Wallet(privateKey, provider)
  if (getAddress(relayer.address) !== getAddress(configuredRelayerAddress)) {
    console.error("[PineTreeBaseTrace] v5 relayer address mismatch — returning unavailable", {
      step: "v5-relay-address-mismatch",
      paymentId: input.paymentId,
      configuredRelayerAddress,
      derivedRelayerAddress: relayer.address
    })
    return unavailable()
  }

  const contract = new Contract(context.splitContract, V5_ABI, relayer)

  const [isRelayerAllowed, isPaymentRefUsed, contractTreasury] = await Promise.all([
    contract.relayers(relayer.address) as Promise<boolean>,
    contract.isPaymentRefUsed(context.paymentId) as Promise<boolean>,
    contract.pineTreeTreasury() as Promise<string>
  ])

  console.info("[PineTreeBaseTrace] v5 relayer contract checks", {
    step: "v5-relay-contract-checks",
    paymentId: input.paymentId,
    splitContract: context.splitContract,
    relayerAddress: relayer.address,
    isRelayerAllowed,
    isPaymentRefUsed,
    contractTreasuryMatchesConfig: getAddress(contractTreasury) === getAddress(context.treasuryWallet)
  })

  if (!isRelayerAllowed) {
    console.error("[PineTreeBaseTrace] v5 relayer not allowlisted — returning unavailable", {
      step: "v5-relay-not-allowlisted",
      paymentId: input.paymentId,
      relayerAddress: relayer.address,
      splitContract: context.splitContract
    })
    return unavailable()
  }

  if (isPaymentRefUsed) {
    throw new Error("Base USDC V5 payment reference has already been used on-chain")
  }

  if (getAddress(contractTreasury) !== getAddress(context.treasuryWallet)) {
    console.error("[PineTreeBaseTrace] v5 relayer treasury mismatch — returning unavailable", {
      step: "v5-relay-treasury-mismatch",
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
  const signatureArgs = {
    v: signature.v,
    r: signature.r,
    s: signature.s
  }

  const estimatedGas = await contract.payUsdcWithAuthorization.estimateGas(
    paymentArgs,
    authorizationArgs,
    signatureArgs
  )
  const feeData = await provider.getFeeData()
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice
  if (!gasPrice) {
    console.warn("[PineTreeBaseTrace] v5 relayer no gas price available — returning unavailable", {
      step: "v5-relay-no-gas-price",
      paymentId: input.paymentId
    })
    return unavailable()
  }

  const gasCostWei = estimatedGas * gasPrice
  const prices = await getMarketPricesUSD()
  const gasCostUsd = Number(formatEther(gasCostWei)) * prices.ETH
  const { maxGasUsd } = getBaseUsdcGasCap()

  const relayerBalance = await provider.getBalance(relayer.address)

  console.info("[PineTreeBaseTrace] v5 relayer gas check", {
    step: "v5-relay-gas-check",
    paymentId: input.paymentId,
    relayerAddress: relayer.address,
    estimatedGas: estimatedGas.toString(),
    gasCostWei: gasCostWei.toString(),
    gasCostUsd: Number.isFinite(gasCostUsd) ? gasCostUsd.toFixed(6) : "NaN",
    maxGasUsd,
    relayerBalanceWei: relayerBalance.toString(),
    gasCostWithinCap: Number.isFinite(gasCostUsd) && gasCostUsd <= maxGasUsd,
    relayerHasSufficientBalance: relayerBalance >= gasCostWei
  })

  if (!Number.isFinite(gasCostUsd) || gasCostUsd > maxGasUsd) {
    console.warn("[PineTreeBaseTrace] v5 relayer gas cap exceeded — returning unavailable", {
      step: "v5-relay-gas-cap-exceeded",
      paymentId: input.paymentId,
      gasCostUsd,
      maxGasUsd
    })
    return unavailable()
  }

  if (relayerBalance < gasCostWei) {
    console.warn("[PineTreeBaseTrace] v5 relayer insufficient ETH balance — returning unavailable", {
      step: "v5-relay-balance-insufficient",
      paymentId: input.paymentId,
      relayerAddress: relayer.address,
      gasCostWei: gasCostWei.toString(),
      relayerBalanceWei: relayerBalance.toString()
    })
    return unavailable()
  }

  console.info("[PineTreeBaseTrace] v5 relayer submitting payUsdcWithAuthorization", {
    step: "v5-relay-submit",
    paymentId: input.paymentId,
    splitContract: context.splitContract,
    relayerAddress: relayer.address,
    merchantAmount: context.merchantAmount.toString(),
    feeAmount: context.feeAmount.toString()
  })

  const tx = await contract.payUsdcWithAuthorization(
    paymentArgs,
    authorizationArgs,
    signatureArgs
  )
  const txHash = String(tx.hash || "")
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error("Base USDC V5 relayer did not return a transaction hash")
  }

  console.info("[PineTreeBaseTrace] v5 relayer txHash returned", {
    step: "v5-relay-tx-submitted",
    paymentId: input.paymentId,
    txHash
  })

  if (existingTransaction?.id) {
    await updateTransactionProviderReference(existingTransaction.id, txHash)
  }

  try {
    const receipt = await provider.waitForTransaction(txHash, 1, 90_000)
    if (receipt) {
      console.info("[PineTreeBaseTrace] v5 relayer receipt mined", {
        step: "v5-relay-receipt",
        paymentId: input.paymentId,
        txHash,
        receiptStatus: receipt.status !== undefined ? String(receipt.status) : "unknown"
      })
      const { runPaymentWatcher } = await import("./checkPaymentOnce")
      let watcherDetected = false
      try {
        watcherDetected = await runPaymentWatcher(input.paymentId, { txHash })
      } catch (watcherErr) {
        console.error("[PineTreeBaseTrace] v5 relayer watcher error", {
          step: "v5-relay-watcher-error",
          paymentId: input.paymentId,
          txHash,
          error: watcherErr instanceof Error ? watcherErr.message : String(watcherErr)
        })
      }
      console.info("[PineTreeBaseTrace] v5 relayer watcher result", {
        step: "v5-relay-watcher-done",
        paymentId: input.paymentId,
        txHash,
        detected: watcherDetected
      })
    }
  } catch (waitErr) {
    console.warn("[PineTreeBaseTrace] v5 relayer wait-for-receipt timeout — cron will detect", {
      step: "v5-relay-wait-timeout",
      paymentId: input.paymentId,
      txHash,
      error: waitErr instanceof Error ? waitErr.message : String(waitErr)
    })
  }

  return { ok: true, status: "submitted", txHash }
}

// ─── Allowance check ──────────────────────────────────────────────────────────

export async function checkBaseUsdcV5Allowance(input: {
  paymentId: string
  payerAddress: string
}): Promise<BaseUsdcV5AllowanceCheckResult> {
  try {
    const context = await loadAllowancePaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress
    })

    const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
    const usdcContract = new Contract(getBaseUsdcTokenAddress(), USDC_ABI, provider)
    const rawAllowance = await usdcContract.allowance(
      context.payerAddress,
      context.splitContract
    ) as bigint

    const allowance = rawAllowance.toString()
    const required = context.totalAmount.toString()
    const sufficient = rawAllowance >= context.totalAmount

    console.info("[PineTreeBaseTrace] v5 allowance check", {
      step: "v5-allowance-check",
      paymentId: context.paymentId,
      payerAddress: context.payerAddress,
      splitContract: context.splitContract,
      allowance,
      required,
      sufficient
    })

    return { ok: true, allowance, required, sufficient }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[PineTreeBaseTrace] v5 allowance check failed", {
      step: "v5-allowance-check-error",
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }
}

// ─── Build allowance-path transactions ───────────────────────────────────────

export async function buildBaseUsdcV5AllowancePayment(input: {
  paymentId: string
  payerAddress: string
}): Promise<BaseUsdcV5AllowancePaymentResult> {
  let context: BaseUsdcV5PaymentContext
  try {
    context = await loadAllowancePaymentContext({
      paymentId: input.paymentId,
      payerAddress: input.payerAddress
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[PineTreeBaseTrace] v5 build-allowance-payment context error", {
      step: "v5-build-allowance-context-error",
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }

  try {
    const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
    const usdcContract = new Contract(getBaseUsdcTokenAddress(), USDC_ABI, provider)
    const rawAllowance = await usdcContract.allowance(
      context.payerAddress,
      context.splitContract
    ) as bigint

    const sufficient = rawAllowance >= context.totalAmount

    const approveTx = sufficient
      ? null
      : {
          to: getBaseUsdcTokenAddress(),
          data: usdcIface.encodeFunctionData("approve", [
            context.splitContract,
            context.totalAmount
          ]),
          value: "0x0",
          chainId: BASE_CHAIN_ID
        }

    const paymentTx = {
      to: context.splitContract,
      data: v5Iface.encodeFunctionData("payUsdcWithAllowance", [
        context.merchantWallet,
        context.treasuryWallet,
        context.merchantAmount,
        context.feeAmount,
        context.paymentId
      ]),
      value: "0x0",
      chainId: BASE_CHAIN_ID
    }

    console.info("[PineTreeBaseTrace] v5 build-allowance-payment ready", {
      step: "v5-build-allowance-ready",
      paymentId: context.paymentId,
      payerAddress: context.payerAddress,
      sufficient,
      currentAllowance: rawAllowance.toString(),
      required: context.totalAmount.toString(),
      hasApproveTx: !sufficient
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
    console.error("[PineTreeBaseTrace] v5 build-allowance-payment failed", {
      step: "v5-build-allowance-error",
      paymentId: input.paymentId,
      error: message
    })
    return unavailable()
  }
}
