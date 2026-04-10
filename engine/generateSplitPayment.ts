import QRCode from "qrcode"
import { buildSolanaPayUri } from "@/providers/solana"

type GenerateSplitPaymentInput = {
  merchantWallet: string
  merchantAmount: number
  pinetreeWallet: string
  pinetreeFee: number
  network: string
  paymentId?: string
}

export async function generateSplitPayment(
  input: GenerateSplitPaymentInput
) {
  const merchantAmount = Number(input.merchantAmount)
  const pinetreeFee = Number(input.pinetreeFee)
  const totalAmount = merchantAmount + pinetreeFee

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

    totalAmount,

    redirect: returnUrl
  }

  const payloadString = JSON.stringify(payload)

  /* --------------------------------
   GENERATE NATIVE PAYMENT URI
   -------------------------------- */

  let paymentUrl: string

  if (input.network === "solana") {
    // Generate native Solana Pay URI with atomic split
    paymentUrl = buildSolanaPayUri({
      recipient: input.merchantWallet,
      amount: totalAmount,
      label: "PineTree Payment",
      message: `Payment #${input.paymentId?.slice(0, 8) || ''}`,
      reference: input.paymentId,
      memo: `pt:split:${input.pinetreeWallet}:${pinetreeFee}`
    })
  } else if (input.network === "base" || input.network === "base_pay" || input.network === "ethereum") {
    // ERC-681 URI for EVM chains
    const chainId = input.network === "ethereum" ? "1" : "8453"
    paymentUrl = `ethereum:${input.merchantWallet}@${chainId}/transfer?address=${input.merchantWallet}&uint256=${totalAmount}`
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
    totalAmount
  }
}