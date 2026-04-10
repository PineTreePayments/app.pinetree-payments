import QRCode from "qrcode"
import { buildSolanaPayUri } from "@/providers/solana"
import { getMarketPricesUSD } from "./marketPrices"

type GenerateSplitPaymentInput = {
  merchantWallet: string
  merchantAmount: number
  pinetreeWallet: string
  pinetreeFee: number
  network: string
  paymentId?: string
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

export async function generateSplitPayment(
  input: GenerateSplitPaymentInput
) {
  const merchantAmount = Number(input.merchantAmount)
  const pinetreeFee = Number(input.pinetreeFee)
  const usdTotalAmount = merchantAmount + pinetreeFee

  let nativeAmount = usdTotalAmount
  let nativeSymbol = "USD"
  let quotePriceUsd: number | null = null

  if (
    input.network === "solana" ||
    input.network === "base" ||
    input.network === "base_pay" ||
    input.network === "ethereum"
  ) {
    const prices = await getMarketPricesUSD()

    if (input.network === "solana") {
      nativeSymbol = "SOL"
      quotePriceUsd = prices.SOL
      nativeAmount = roundAmount(usdTotalAmount / prices.SOL, 9)
    } else {
      nativeSymbol = "ETH"
      quotePriceUsd = prices.ETH
      nativeAmount = roundAmount(usdTotalAmount / prices.ETH, 18)
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

  if (
    input.network === "base" ||
    input.network === "base_pay" ||
    input.network === "ethereum"
  ) {
    returnPath = "/base-return"
  }

  if (input.network === "coinbase") {
    returnPath = "/coinbase-return"
  }

  const returnUrl = `${BASE_URL}${returnPath}`

  /* --------------------------------
  BUILD STRUCTURED PAYMENT PAYLOAD
  -------------------------------- */

  const payload = {
    type: "pinetree_split_payment",
    network: input.network,
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

  if (input.network === "solana") {
    paymentUrl = buildSolanaPayUri({
      recipient: input.merchantWallet,
      amount: nativeAmount,
      label: "PineTree Payment",
      message: `Payment #${input.paymentId?.slice(0, 8) || ""}`,
      reference: input.paymentId,
      memo: `pt:split:${input.pinetreeWallet}:${pinetreeFee}`
    })
  } else if (input.network === "base" || input.network === "base_pay" || input.network === "ethereum") {
    const chainId = input.network === "ethereum" ? "1" : "8453"
    paymentUrl = `ethereum:${input.merchantWallet}@${chainId}?value=${toWeiString(nativeAmount)}`
  } else {
    paymentUrl = `pinetree://pay?data=${encodeURIComponent(payloadString)}`
  }

  /* --------------------------------
   GENERATE CAMERA-SCANNABLE UNIVERSAL LINK
   -------------------------------- */

  const universalUrl = `${BASE_URL}/pay?data=${encodeURIComponent(payloadString)}`

  /* --------------------------------
  GENERATE QR CODE
  -------------------------------- */

  const qrCodeUrl = await QRCode.toDataURL(universalUrl)

  return {
    paymentUrl,
    universalUrl,
    qrCodeUrl,
    totalAmount: usdTotalAmount,
    usdTotalAmount,
    nativeAmount,
    nativeSymbol
  }
}