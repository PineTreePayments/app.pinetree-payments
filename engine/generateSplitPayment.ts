import QRCode from "qrcode"
import { getMarketPricesUSD } from "./marketPrices"

type GenerateSplitPaymentInput = {
  merchantWallet: string
  merchantAmount: number
  pinetreeWallet: string
  pinetreeFee: number
  network: string
  paymentId?: string
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
  const merchantAmount = Number(input.merchantAmount)
  const pinetreeFee = Number(input.pinetreeFee)
  const usdTotalAmount = merchantAmount + pinetreeFee

  let nativeAmount = usdTotalAmount
  let merchantNativeAmount = Number(input.merchantAmount)
  let feeNativeAmount = Number(input.pinetreeFee)
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
    const txRequestUrl = `${BASE_URL}/api/solana-pay/transaction?paymentId=${encodeURIComponent(
      String(input.paymentId || "")
    )}`

    // Solana Pay transaction-request URL (wallet requests unsigned tx with split transfers)
    paymentUrl = txRequestUrl
  } else if (input.network === "base" || input.network === "base_pay" || input.network === "ethereum") {
    // EVM chains: contract-based split (if configured) with safe fallback to direct transfer URI
    const chainId = input.network === "ethereum" ? "1" : "8453"

    const splitMode = getEvmSplitMode()
    const splitContract = getEvmSplitContract(input.network)

    if (splitMode === "contract" && isEvmAddress(splitContract)) {
      // EIP-681 style contract invocation URI for split execution
      const query = new URLSearchParams({
        merchant: input.merchantWallet,
        treasury: input.pinetreeWallet,
        merchantAmountWei: toWeiString(merchantNativeAmount),
        feeAmountWei: toWeiString(feeNativeAmount),
        reference: String(input.paymentId || "")
      })

      paymentUrl = `ethereum:${splitContract}@${chainId}/split?${query.toString()}`
    } else {
      paymentUrl = `ethereum:${input.merchantWallet}@${chainId}?value=${toWeiString(nativeAmount)}`
    }
  } else {
    // Fallback to universal format
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
    nativeSymbol,
    merchantNativeAmount,
    feeNativeAmount,
    merchantNativeAmountAtomic: input.network === "solana" ? toLamports(merchantNativeAmount) : toWeiString(merchantNativeAmount),
    feeNativeAmountAtomic: input.network === "solana" ? toLamports(feeNativeAmount) : toWeiString(feeNativeAmount)
  }
}