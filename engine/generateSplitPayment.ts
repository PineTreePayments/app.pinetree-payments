import QRCode from "qrcode"
import { Interface } from "ethers"
import { getMarketPricesUSD } from "./marketPrices"
import { getBaseUsdcV4Contract } from "./config"
import type { BaseUsdcStrategy } from "@/types/payment"

// USDC contract address on Base mainnet
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

const SPLIT_ABI = [
  "function split(address merchant, address treasury, uint256 merchantAmountWei, uint256 feeAmountWei, string paymentRef) payable",
  "function splitToken(address merchant, address treasury, uint256 merchantAmount, uint256 feeAmount, string paymentRef, address token)"
]
const splitIface = new Interface(SPLIT_ABI)

type GenerateSplitPaymentInput = {
  merchantWallet: string
  merchantAmount: number
  pinetreeWallet: string
  pinetreeFee: number
  network: string
  /** Wallet asset type — drives token selection on Base (e.g. "eth-base" vs "base-usdc") */
  asset?: string
  paymentId?: string
  providerPayment?: unknown
  /** Base USDC execution strategy. Defaults to V1 approval flow to preserve current checkout. */
  baseUsdcStrategy?: BaseUsdcStrategy
  /**
   * When provided by the adapter, always use this instead of deriving from network.
   * Coinbase (invoice_split) lives on the "base" network but is NOT contract_split.
   */
  feeCaptureMethodOverride?: string
}

function toLamports(amountSol: number): number {
  const safe = Number.isFinite(amountSol) && amountSol > 0 ? amountSol : 0
  return Math.round(safe * 1_000_000_000)
}

function roundAmount(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

function toWeiString(amountEth: number): string {
  const safe = Number.isFinite(amountEth) && amountEth > 0 ? amountEth : 0
  const [whole, fraction = ""] = safe.toFixed(18).split(".")
  const normalized = `${whole}${fraction.padEnd(18, "0").slice(0, 18)}`.replace(/^0+/, "")
  return normalized || "0"
}

// USDC has 6 decimals; 1 USDC = 1 USD
function toUSDCAtomicString(amountUsd: number): string {
  const safe = Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : 0
  return String(Math.round(safe * 1_000_000))
}

function isUsdcAsset(asset?: string): boolean {
  const a = String(asset || "").toLowerCase().trim()
  return a === "base-usdc" || a === "usdc-base" || a === "sol-usdc"
}

function isBaseUsdcAsset(asset?: string): boolean {
  const a = String(asset || "").toLowerCase().trim()
  return a === "base-usdc" || a === "usdc-base"
}

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim())
}

function getEvmSplitContract(network: string): string {
  if (network === "ethereum") {
    return String(process.env.PINETREE_EVM_SPLIT_CONTRACT_ETHEREUM || "").trim()
  }

  return String(process.env.PINETREE_EVM_SPLIT_CONTRACT_BASE || "").trim()
}

function resolveBaseUsdcStrategy(input: GenerateSplitPaymentInput): BaseUsdcStrategy | undefined {
  const network = input.network === "base_pay" ? "base" : input.network
  if (network !== "base" || !isBaseUsdcAsset(input.asset)) return undefined

  // Conservative Phase 2 default: keep the currently working V1 approve → splitToken flow
  // active until the V4 frontend signature flow and backend relayer routes are implemented.
  return input.baseUsdcStrategy || "v1_approve_splitToken"
}

export async function generateSplitPayment(
  input: GenerateSplitPaymentInput
) {
  // Normalise network once — "base_pay" is a legacy alias for "base"
  const network = input.network === "base_pay" ? "base" : input.network

  const merchantAmount = Number(input.merchantAmount)
  const pinetreeFee = Number(input.pinetreeFee)
  const usdTotalAmount = merchantAmount + pinetreeFee

  const isUsdc = isUsdcAsset(input.asset)
  const baseUsdcStrategy = resolveBaseUsdcStrategy({ ...input, network })

  let nativeAmount = usdTotalAmount
  let merchantNativeAmount = Number(input.merchantAmount)
  let feeNativeAmount = Number(input.pinetreeFee)
  let nativeSymbol = "USD"
  let quotePriceUsd: number | null = null

  if (network === "solana" && !isUsdc) {
    const prices = await getMarketPricesUSD()
    nativeSymbol = "SOL"
    quotePriceUsd = prices.SOL
    nativeAmount = roundAmount(usdTotalAmount / prices.SOL, 9)
    merchantNativeAmount = roundAmount(merchantAmount / prices.SOL, 9)
    feeNativeAmount = roundAmount(pinetreeFee / prices.SOL, 9)
  } else if (network === "solana" && isUsdc) {
    // SOL-USDC: amounts stay in USD (1:1 with USDC)
    nativeSymbol = "USDC"
    quotePriceUsd = 1
  } else if (network === "base" && !isUsdc) {
    const prices = await getMarketPricesUSD()
    nativeSymbol = "ETH"
    quotePriceUsd = prices.ETH
    nativeAmount = roundAmount(usdTotalAmount / prices.ETH, 18)
    merchantNativeAmount = roundAmount(merchantAmount / prices.ETH, 18)
    feeNativeAmount = roundAmount(pinetreeFee / prices.ETH, 18)
  } else if (network === "base" && isUsdc) {
    // USDC on Base: amounts stay in USD (1:1 with USDC)
    nativeSymbol = "USDC"
    quotePriceUsd = 1
  }

  /* --------------------------------
  BASE URL (PRODUCTION SAFE)
  -------------------------------- */

  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL
  if (!BASE_URL || !BASE_URL.startsWith("https://")) {
    throw new Error("NEXT_PUBLIC_APP_URL must be set to a full https:// production domain")
  }

  if (network === "solana") {
    const solanaPaymentUrl = `${BASE_URL}/api/solana-pay/transaction?paymentId=${String(input.paymentId || "")}`
    console.log("FINAL SOLANA PAYMENT URL:", solanaPaymentUrl)
  }

  /* --------------------------------
  🔥 FIX: DYNAMIC RETURN BASED ON NETWORK
  -------------------------------- */

  let returnPath = "/solana-return"

  if (network === "base") {
    returnPath = "/base-return"
  }

  const returnUrl = `${BASE_URL}${returnPath}`

  // Provider-declared method takes precedence over network-derived guess.
  // This is critical: Coinbase lives on "base" but uses invoice_split (hosted checkout),
  // NOT contract_split. If the adapter returned a feeCaptureMethod, always trust it.
  const feeCaptureMethod: string =
    input.feeCaptureMethodOverride ||
    (network === "solana"
      ? "atomic_split"
      : network === "base"
        ? "contract_split"
        : "invoice_split")

  /* --------------------------------
  BUILD STRUCTURED PAYMENT PAYLOAD
  -------------------------------- */

  const payload = {
    type: "pinetree_split_payment",
    network,
    feeCaptureMethod,
    reference: input.paymentId || crypto.randomUUID(),
    ...(baseUsdcStrategy ? { baseUsdcStrategy } : {}),

    outputs: [
      {
        address: input.merchantWallet,
        amount: merchantAmount
      },
      {
        address: input.pinetreeWallet,
        amount: pinetreeFee
      }
    ],

    totalAmount: usdTotalAmount,
    usdTotalAmount,
    nativeAmount,
    nativeSymbol,
    quotePriceUsd,

    redirect: returnUrl
  }

  const payloadString = JSON.stringify(payload)

  /* --------------------------------
   GENERATE NATIVE PAYMENT URI
   -------------------------------- */

  let paymentUrl: string
  let evmSplitContract: string | undefined

  if (network === "solana") {
    const txRequestUrl = `${BASE_URL}/api/solana-pay/transaction?paymentId=${String(input.paymentId || "")}`
    paymentUrl = txRequestUrl
  } else if (network === "base") {
    if (feeCaptureMethod === "invoice_split" || feeCaptureMethod === "collection_then_settle") {
      paymentUrl = `pinetree://pay?data=${encodeURIComponent(payloadString)}`
    } else {
      const chainId = "8453"
      // Base always requires a deployed split contract — direct transfer is not supported.
      evmSplitContract = baseUsdcStrategy === "v4_eip3009_relayer"
        ? getBaseUsdcV4Contract()
        : getEvmSplitContract(network)

      if (!isEvmAddress(evmSplitContract)) {
        throw new Error(
          "Base payments require a deployed split contract. Set PINETREE_EVM_SPLIT_CONTRACT_BASE to a valid contract address."
        )
      }
      if (isUsdc && baseUsdcStrategy === "v4_eip3009_relayer") {
        // USDC on Base V4: no wallet transaction calldata is generated here.
        // The customer will sign EIP-3009 typed data, and the PineTree backend relayer
        // will submit payWithUsdcAuthorization(...) in a later phase.
        paymentUrl = `pinetree://base-usdc-v4?paymentId=${encodeURIComponent(String(input.paymentId || ""))}`
      } else if (isUsdc) {
        // USDC on Base: ABI-encode splitToken() calldata
        // Caller must approve the split contract for (merchantAmount + feeAmount) USDC first.
        const calldata = splitIface.encodeFunctionData("splitToken", [
          input.merchantWallet,
          input.pinetreeWallet,
          BigInt(toUSDCAtomicString(merchantNativeAmount)),
          BigInt(toUSDCAtomicString(feeNativeAmount)),
          String(input.paymentId || ""),
          USDC_BASE
        ])
        paymentUrl = `ethereum:${evmSplitContract}@${chainId}?data=${calldata}`
      } else {
        // ETH on Base: ABI-encode split() calldata + embed total ETH value
        const totalWei = toWeiString(nativeAmount)
        const calldata = splitIface.encodeFunctionData("split", [
          input.merchantWallet,
          input.pinetreeWallet,
          BigInt(toWeiString(merchantNativeAmount)),
          BigInt(toWeiString(feeNativeAmount)),
          String(input.paymentId || "")
        ])
        paymentUrl = `ethereum:${evmSplitContract}@${chainId}?value=${totalWei}&data=${calldata}`
      }
    }
  } else {
    paymentUrl = `pinetree://pay?data=${encodeURIComponent(payloadString)}`
  }

  const universalUrl = `${BASE_URL}/pay?data=${encodeURIComponent(payloadString)}`

  const isNativeWalletRail =
    network === "solana" ||
    (network === "base" && feeCaptureMethod === "contract_split")

  const qrSource =
    network === "solana"
      ? `solana:${paymentUrl}`
      : isNativeWalletRail
      ? paymentUrl
      : universalUrl
  const qrCodeUrl = await QRCode.toDataURL(qrSource)

  let merchantNativeAmountAtomic: string | number
  let feeNativeAmountAtomic: string | number

  if (network === "solana" && !isUsdc) {
    merchantNativeAmountAtomic = toLamports(merchantNativeAmount)
    feeNativeAmountAtomic = toLamports(feeNativeAmount)
  } else if (isUsdc) {
    merchantNativeAmountAtomic = toUSDCAtomicString(merchantNativeAmount)
    feeNativeAmountAtomic = toUSDCAtomicString(feeNativeAmount)
  } else {
    merchantNativeAmountAtomic = toWeiString(merchantNativeAmount)
    feeNativeAmountAtomic = toWeiString(feeNativeAmount)
  }

  return {
    paymentUrl,
    universalUrl,
    qrCodeUrl,
    feeCaptureMethod,
    totalAmount: usdTotalAmount,
    usdTotalAmount,
    nativeAmount,
    nativeSymbol,
    merchantNativeAmount,
    feeNativeAmount,
    merchantNativeAmountAtomic,
    feeNativeAmountAtomic,
    splitContract: evmSplitContract,
    baseUsdcStrategy
  }
}