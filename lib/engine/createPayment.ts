/**
 * PineTree Payment Creation
 * 
 * Central payment creation logic for the PineTree platform.
 * Handles the complete payment creation flow from validation to database storage.
 */

import { chooseBestProvider } from "./providerSelector"
import { getProvider } from "./providerRegistry"
import { PaymentProvider } from "@/types/payment"
import {
  createPayment as createPaymentRecord,
  createTransaction,
  getIdempotencyKey,
  storeIdempotencyKey,
  getPaymentById
} from "@/lib/database"
import { generateSplitPayment } from "./generateSplitPayment"
import { watchPayment } from "./paymentWatcher"
import { calculateGrossAmount } from "./fees"
import { getMerchantDefaultProvider } from "@/lib/database/merchants"

type CreatePaymentInput = {
  amount: number
  currency: string
  provider?: PaymentProvider
  merchantId: string
  channel?: "pos" | "online" | "api" | "invoice"
  metadata?: any
  idempotencyKey?: string
  pinetreeFee?: number
}

type CreatePaymentResult = {
  id: string
  provider: string
  paymentUrl: string
  qrCodeUrl: string
}

/**
 * Create a new payment
 * 
 * This is the main entry point for creating payments in the PineTree system.
 * It handles idempotency, provider selection, fee calculation, and payment storage.
 */
export async function createPayment(
  input: CreatePaymentInput
): Promise<CreatePaymentResult> {

  /* ---------------------------
     IDEMPOTENCY PROTECTION
  --------------------------- */

  if (input.idempotencyKey) {
    const existingPaymentId = await getIdempotencyKey(input.idempotencyKey)
    
    if (existingPaymentId) {
      const existingPayment = await getPaymentById(existingPaymentId)
      
      if (existingPayment) {
        return {
          id: existingPayment.id,
          provider: existingPayment.provider,
          paymentUrl: existingPayment.payment_url || "",
          qrCodeUrl: existingPayment.qr_code_url || ""
        }
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

  const merchantAmount = input.metadata?.merchantAmount ?? input.amount
  const pinetreeFee = input.pinetreeFee ?? input.metadata?.pinetreeFee ?? 0
  const grossAmount = calculateGrossAmount(merchantAmount, pinetreeFee)

  /* ---------------------------
     GET MERCHANT WALLET
  --------------------------- */

  if (!provider.getMerchantWallet) {
    throw new Error("Provider does not support wallet rails")
  }

  const merchantWalletData = await provider.getMerchantWallet(input.merchantId)
  const merchantWallet = merchantWalletData.address
  const network = merchantWalletData.network

  /* ---------------------------
     PINETREE TREASURY WALLET
  --------------------------- */

  const pinetreeWallet = process.env.PINETREE_TREASURY_WALLET || ""

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
    network,
    paymentId
  })

  /* ---------------------------
     INSERT PAYMENT RECORD
  --------------------------- */

  const payment = await createPaymentRecord({
    id: paymentId,
    merchant_id: input.merchantId,
    merchant_amount: merchantAmount,
    pinetree_fee: pinetreeFee,
    gross_amount: grossAmount,
    currency: input.currency,
    provider: providerName,
    network: network,
    payment_url: splitPayment.paymentUrl,
    qr_code_url: splitPayment.qrCodeUrl,
    metadata: input.metadata
  })

  /* ---------------------------
     DETERMINE CHANNEL
  --------------------------- */

  const channel = input.channel ?? "pos"

  /* ---------------------------
     INSERT TRANSACTION RECORD
  --------------------------- */

  const transactionId = crypto.randomUUID()
  
  await createTransaction({
    id: transactionId,
    payment_id: paymentId,
    merchant_id: input.merchantId,
    provider: providerName,
    network: network,
    channel: channel
  })

  /* ---------------------------
     STORE IDEMPOTENCY KEY
  --------------------------- */

  if (input.idempotencyKey) {
    await storeIdempotencyKey(input.idempotencyKey, paymentId)
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