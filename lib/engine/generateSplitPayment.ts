import QRCode from "qrcode"

type GenerateSplitPaymentInput = {
  merchantWallet: string
  merchantAmount: number
  pinetreeWallet: string
  pinetreeFee: number
  network: string
}

export async function generateSplitPayment(
  input: GenerateSplitPaymentInput
) {
  const merchantAmount = Number(input.merchantAmount)
  const pinetreeFee = Number(input.pinetreeFee)
  const totalAmount = merchantAmount + pinetreeFee

  /* --------------------------------
  BUILD STRUCTURED PAYMENT PAYLOAD
  -------------------------------- */

  const payload = {
    type: "pinetree_split_payment",
    network: input.network,
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
    totalAmount
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