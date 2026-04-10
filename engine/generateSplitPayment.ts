import QRCode from "qrcode"

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
  BUILD PINETREE PAYMENT URI
  -------------------------------- */

  const paymentUrl = `pinetree://pay?data=${encodeURIComponent(payloadString)}`

  /* --------------------------------
  GENERATE QR CODE
  -------------------------------- */

  const qrCodeUrl = await QRCode.toDataURL(paymentUrl)

  return {
    paymentUrl,
    qrCodeUrl,
    totalAmount
  }
}