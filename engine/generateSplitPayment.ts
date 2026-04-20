import QRCode from "qrcode"
import { getMarketPricesUSD } from "./marketPrices"

type GenerateSplitPaymentInput = {
  merchantWallet: string
  merchantAmount: number
  pinetreeWallet: string
  pinetreeFee: number
  network: string
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

  let nativeAmount = usdTotalAmount
  let merchantNativeAmount = Number(input.merchantAmount)
  let feeNativeAmount = Number(input.pinetreeFee)
  let nativeSymbol = "USD"
  let quotePriceUsd: number | null = null

  if (
    network === "solana" ||
    network === "base" ||
    network === "ethereum"
  ) {
    const prices = await getMarketPricesUSD()

    if (network === "solana") {
      nativeSymbol = "SOL"
      quotePriceUsd = prices.SOL
      nativeAmount = roundAmount(usdTotalAmount / prices.SOL, 9)
      merchantNativeAmount = roundAmount(merchantAmount / prices.SOL, 9)
      feeNativeAmount = roundAmount(pinetreeFee / prices.SOL, 9)
    } else {
      nativeSymbol = "ETH"
      quotePriceUsd = prices.ETH
      nativeAmount = roundAmount(usdTotalAmount / prices.ETH, 18)
      merchantNativeAmount = roundAmount(merchantAmount / prices.ETH, 18)
      feeNativeAmount = roundAmount(pinetreeFee / prices.ETH, 18)
    }
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

  if (network === "base" || network === "ethereum") {
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
      : network === "base" || network === "ethereum"
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
  } else if (network === "base" || network === "ethereum") {
    if (feeCaptureMethod === "invoice_split" || feeCaptureMethod === "collection_then_settle") {
      paymentUrl = `pinetree://pay?data=${encodeURIComponent(payloadString)}`
    } else {
      const chainId = network === "ethereum" ? "1" : "8453"
      const splitMode = getEvmSplitMode()

      if (splitMode === "contract") {
        const splitContract = getEvmSplitContract(network)

        if (!isEvmAddress(splitContract)) {
          throw new Error(
            `EVM rails require a valid split contract address for ${network}. Configure PINETREE_EVM_SPLIT_CONTRACT_${
              network === "ethereum" ? "ETHEREUM" : "BASE"
            }.`
          )
        }

        const grossWei = toWeiString(nativeAmount)
        const query = new URLSearchParams({
          value: grossWei,
          merchant: input.merchantWallet,
          treasury: input.pinetreeWallet,
          merchantAmountWei: toWeiString(merchantNativeAmount),
          feeAmountWei: toWeiString(feeNativeAmount),
          reference: String(input.paymentId || "")
        })

        paymentUrl = `ethereum:${splitContract}@${chainId}/split?${query.toString()}`
      } else {
        feeCaptureMethod = "direct"
        paymentUrl = `ethereum:${input.merchantWallet}@${chainId}?value=${toWeiString(nativeAmount)}`
      }
    }
  } else {
    paymentUrl = `pinetree://pay?data=${encodeURIComponent(payloadString)}`
  }

  const universalUrl = `${BASE_URL}/pay?data=${encodeURIComponent(payloadString)}`

  const isNativeWalletRail =
    network === "solana" ||
    ((network === "base" || network === "ethereum") && feeCaptureMethod === "contract_split")

  const qrSource = isNativeWalletRail ? paymentUrl : universalUrl
  const qrCodeUrl = await QRCode.toDataURL(qrSource)

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
    merchantNativeAmountAtomic: network === "solana" ? toLamports(merchantNativeAmount) : toWeiString(merchantNativeAmount),
    feeNativeAmountAtomic: network === "solana" ? toLamports(feeNativeAmount) : toWeiString(feeNativeAmount)
  }
}