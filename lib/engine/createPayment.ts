import { chooseBestProvider } from "./providerSelector"
import { getProvider } from "./providerRegistry"
import { PaymentProvider } from "@/types/payment"
import { supabase } from "@/lib/database/supabase"
import { generateSplitPayment } from "./generateSplitPayment"
import { watchPayment } from "./paymentWatcher"

type CreatePaymentInput = {
  amount: number
  currency: string
  provider?: PaymentProvider
  merchantId: string
  channel?: "pos" | "online" | "api" | "invoice"
  metadata?: any
  idempotencyKey?: string
}

export async function createPayment(input: CreatePaymentInput) {

  /* ---------------------------
  IDEMPOTENCY PROTECTION
  --------------------------- */

  if (input.idempotencyKey) {

    const { data: existing } = await supabase
      .from("idempotency_keys")
      .select("payment_id")
      .eq("key", input.idempotencyKey)
      .maybeSingle()

    if (existing?.payment_id) {

      const { data: payment } = await supabase
        .from("payments")
        .select("*")
        .eq("id", existing.payment_id)
        .single()

      return {
        id: payment.id,
        provider: payment.provider,
        paymentUrl: payment.payment_url,
        qrCodeUrl: payment.qr_code_url
      }

    }

  }

  /* ---------------------------
  PROVIDER SELECTION
  --------------------------- */

  let providerName = input.provider

  if (!providerName) {
    providerName = await chooseBestProvider(input.merchantId)
  }

  if (!providerName) {
    throw new Error("No payment provider connected")
  }

  const provider = getProvider(providerName)

  if (!provider) {
    throw new Error(`Provider ${providerName} not registered`)
  }

  /* ---------------------------
  EXTRACT PINETREE FEE DATA
  --------------------------- */

  const merchantAmount =
    input.metadata?.merchantAmount ?? input.amount

  const pinetreeFee =
    input.metadata?.pinetreeFee ?? 0

  const grossAmount = input.amount

  /* ---------------------------
  GET MERCHANT WALLET
  --------------------------- */

  if (!provider.getMerchantWallet) {
    throw new Error("Provider does not support wallet rails")
  }

  const merchantWalletData =
    await provider.getMerchantWallet(input.merchantId)

  const merchantWallet = merchantWalletData.address
  const network = merchantWalletData.network

  /* ---------------------------
  PINETREE TREASURY WALLET
  --------------------------- */

  const pinetreeWallet =
    process.env.PINETREE_TREASURY_WALLET || ""

  if (!pinetreeWallet) {
    throw new Error("PineTree treasury wallet not configured")
  }

  /* ---------------------------
  CREATE PAYMENT ID
  --------------------------- */

  const paymentId = crypto.randomUUID()

  /* ---------------------------
  GENERATE SPLIT PAYMENT
  --------------------------- */

  const splitPayment = await generateSplitPayment({
    merchantWallet,
    merchantAmount,
    pinetreeWallet,
    pinetreeFee,
    network
  })

  /* ---------------------------
  INSERT PAYMENT RECORD
  --------------------------- */

  const { error: paymentError } = await supabase
    .from("payments")
    .insert({
      id: paymentId,
      merchant_id: input.merchantId,
      currency: input.currency,
      subtotal_amount: merchantAmount,
      platform_fee: pinetreeFee,
      total_amount: grossAmount,
      provider: providerName,
      status: "PENDING",
      payment_url: splitPayment.paymentUrl,
      qr_code_url: splitPayment.qrCodeUrl,
      metadata: input.metadata
    })

  if (paymentError) {
    throw new Error(paymentError.message)
  }

  /* ---------------------------
  DETERMINE CHANNEL
  --------------------------- */

  const channel = input.channel ?? "pos"

  /* ---------------------------
  INSERT TRANSACTION RECORD
  --------------------------- */

  const { error: txError } = await supabase
    .from("transactions")
    .insert({
      payment_id: paymentId,
      provider: providerName,
      network: network,
      status: "PENDING",
      channel: channel
    })

  if (txError) {
    throw new Error(txError.message)
  }

  /* ---------------------------
  STORE IDEMPOTENCY KEY
  --------------------------- */

  if (input.idempotencyKey) {

    await supabase
      .from("idempotency_keys")
      .insert({
        key: input.idempotencyKey,
        payment_id: paymentId
      })

  }

  /* ---------------------------
  START PAYMENT WATCHER
  --------------------------- */

  watchPayment({
    merchantWallet,
    pinetreeWallet,
    merchantAmount,
    pinetreeFee,
    network,
    paymentId
  }).catch(console.error)

  /* ---------------------------
  RETURN RESULT
  --------------------------- */

  return {
    id: paymentId,
    provider: providerName,
    paymentUrl: splitPayment.paymentUrl,
    qrCodeUrl: splitPayment.qrCodeUrl
  }

}