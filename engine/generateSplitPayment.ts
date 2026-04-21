import QRCode from "qrcode"
import { getMarketPricesUSD } from "./marketPrices"

// USDC contract address on Base mainnet
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

type GenerateSplitPaymentInput = {
  merchantWallet: string
  merchantAmount: number
  pinetreeWallet: string
  pinetreeFee: number
  network: string
  /** Wallet asset type — drives token selection on Base (e.g. "eth-base" vs "usdc-base") */
  asset?: string
  paymentId?: string
  providerPayment?: unknown
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
  return a === "usdc-base" || a === "sol-usdc"
}

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim())
}

function getEvmSplitMode(): "direct" | "contract" {
  const mode = String(process.env.PINETREE_EVM_SPLIT_MODE || "direct").toLowerCase().trim()
  return mode === "contract" ? "contract" : "direct"
}

function getEvmSplitContract(network: string): string {
  if (network === "ethereum") {
    return String(process.env.PINETREE_EVM_SPLIT_CONTRACT_ETHEREUM || "").trim()
  }

  return String(process.env.PINETREE_EVM_SPLIT_CONTRACT_BASE || "").trim()
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

  const BASE_URL =
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.pinetree-payments.com"

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
  let feeCaptureMethod: string =
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

  if (network === "solana") {
    const txRequestUrl = `${BASE_URL}/api/solana-pay/transaction?paymentId=${encodeURIComponent(
      String(input.paymentId || "")
    )}`
    paymentUrl = `solana:${txRequestUrl}`
  } else if (network === "base") {
    if (feeCaptureMethod === "invoice_split" || feeCaptureMethod === "collection_then_settle") {
      paymentUrl = `pinetree://pay?data=${encodeURIComponent(payloadString)}`
    } else {
      const chainId = "8453"
      const splitMode = getEvmSplitMode()
      const splitContract = splitMode === "contract" ? getEvmSplitContract(network) : ""

      if (splitMode === "contract" && isEvmAddress(splitContract)) {
        if (isUsdc) {
          // USDC on Base: call splitToken() — amounts in USDC atomic units (6 decimals)
          // Caller must approve the split contract before calling splitToken.
          const query = new URLSearchParams({
            address: input.merchantWallet,
            address1: input.pinetreeWallet,
            uint256: toUSDCAtomicString(merchantNativeAmount),
            uint2561: toUSDCAtomicString(feeNativeAmount),
            string: String(input.paymentId || ""),
            address2: USDC_BASE
          })
          paymentUrl = `ethereum:${splitContract}@${chainId}/splitToken?${query.toString()}`
        } else {
          // ETH on Base: call split() — amounts in wei (18 decimals), send value
          const query = new URLSearchParams({
            value: toWeiString(nativeAmount),
            address: input.merchantWallet,
            address1: input.pinetreeWallet,
            uint256: toWeiString(merchantNativeAmount),
            uint2561: toWeiString(feeNativeAmount),
            string: String(input.paymentId || "")
          })
          paymentUrl = `ethereum:${splitContract}@${chainId}/split?${query.toString()}`
        }
      } else {
        // Direct mode (default) or contract mode without an address configured
        feeCaptureMethod = "direct"
        if (isUsdc) {
          // Direct USDC transfer to merchant (fee capture skipped in direct mode)
          paymentUrl = `ethereum:${USDC_BASE}@${chainId}/transfer?address=${input.merchantWallet}&uint256=${toUSDCAtomicString(nativeAmount)}`
        } else {
          paymentUrl = `ethereum:${input.merchantWallet}@${chainId}?value=${toWeiString(nativeAmount)}`
        }
      }
    }
  } else {
    paymentUrl = `pinetree://pay?data=${encodeURIComponent(payloadString)}`
  }

  const universalUrl = `${BASE_URL}/pay?data=${encodeURIComponent(payloadString)}`

  const isNativeWalletRail =
    network === "solana" ||
    (network === "base" && feeCaptureMethod === "contract_split")

  const qrSource = isNativeWalletRail ? paymentUrl : universalUrl
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
    feeNativeAmountAtomic
  }
}