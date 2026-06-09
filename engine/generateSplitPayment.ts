import QRCode from "qrcode"
import { Interface } from "ethers"
import { getMarketPricesUSD } from "./marketPrices"
import { getBaseV7Contract } from "./config"

const SPLIT_ETH_ABI = [
  "function splitEth(address merchant, address treasury, uint256 merchantAmountWei, uint256 feeAmountWei, string paymentRef) payable"
]
const splitEthIface = new Interface(SPLIT_ETH_ABI)

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
  baseUsdcStrategy?: string
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

export async function generateSplitPayment(
  input: GenerateSplitPaymentInput
) {
  // Normalise network once — "base_pay" is a legacy alias for "base"
  const network = input.network === "base_pay" ? "base" : input.network

  const merchantAmount = Number(input.merchantAmount)
  const pinetreeFee = Number(input.pinetreeFee)
  const usdTotalAmount = merchantAmount + pinetreeFee

  const isUsdc = isUsdcAsset(input.asset)
  const baseUsdcStrategy = (network === "base" && isBaseUsdcAsset(input.asset)) ? input.baseUsdcStrategy : undefined

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
  RETURN PATH BY NETWORK
  -------------------------------- */

  // Solana Pay uses a return page for deeplink callbacks.
  // Base V7 (WalletConnect) does not use a return redirect — the
  // payload.redirect field is only embedded in legacy pinetree://pay paths
  // (invoice_split / collection_then_settle), not in the active V7 flow.
  const returnPath = network === "solana" ? "/solana-return" : "/"

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

      // ── V7 split contract ────────────────────────────────────────────────────
      evmSplitContract = getBaseV7Contract()

      if (isUsdc) {
        paymentUrl = `pinetree://base-v7?paymentId=${encodeURIComponent(String(input.paymentId || ""))}`
      } else {
        const merchantAmountWei = BigInt(toWeiString(merchantNativeAmount))
        const feeAmountWei = BigInt(toWeiString(feeNativeAmount))
        const totalWei = (merchantAmountWei + feeAmountWei).toString()
        const calldata = splitEthIface.encodeFunctionData("splitEth", [
          input.merchantWallet,
          input.pinetreeWallet,
          merchantAmountWei,
          feeAmountWei,
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
