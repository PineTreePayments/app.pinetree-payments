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
} from "@/database"
import { generateSplitPayment } from "./generateSplitPayment"
import { watchPayment } from "./paymentWatcher"
import { calculateGrossAmount } from "./fees"
import { selectBestWallet } from "@/database/merchantWallets"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { loadProviders } from "./loadProviders"
import { providerToPreferredNetwork } from "./providerMappings"
import {
  getPineTreeTreasuryWallet,
  assertTreasuryWalletFormat,
  validateConfigOnce
} from "./config"

type PaymentMetadata = {
  merchantAmount?: number
  pinetreeFee?: number
  [key: string]: unknown
}

type StoredPaymentSplitMetadata = {
  split?: {
    merchantWallet?: string
  }
}

type CreatePaymentInput = {
  amount: number
  currency: string
  provider?: PaymentProvider
  merchantId: string
  preferredNetwork?: string
  channel?: "pos" | "online" | "api" | "invoice"
  metadata?: PaymentMetadata
  idempotencyKey?: string
  pinetreeFee?: number
}

type CreatePaymentResult = {
  id: string
  provider: string
  paymentUrl: string
  qrCodeUrl: string
  address?: string
  universalUrl?: string
}

export type BuildCreatePaymentRequestInput = {
  amount: number
  currency: string
  merchantId: string
  provider?: PaymentProvider
  terminalId?: string
  pinetreeFee?: number
  metadata?: Record<string, unknown>
}

export type BuildCreatePaymentRequestResult = {
  createPaymentInput: CreatePaymentInput
  breakdown: {
    merchantAmount: number
    taxAmount: number
    pinetreeFee: number
    grossAmount: number
  }
}

export async function buildCreatePaymentRequest(
  input: BuildCreatePaymentRequestInput
): Promise<BuildCreatePaymentRequestResult> {
  const merchantAmount = Number(input.amount)

  if (isNaN(merchantAmount) || merchantAmount <= 0) {
    throw new Error("Invalid payment amount")
  }

  const currency = String(input.currency || "").trim()
  const merchantId = String(input.merchantId || "").trim()

  if (!currency || !merchantId) {
    throw new Error("Missing required payment fields")
  }

  if (!input.provider) {
    throw new Error("No payment provider connected")
  }

  let taxAmount = 0

  try {
    const { getMerchantTaxSettings } = await import("@/database/merchants")
    const { calculateTax, calculateGrossAmount } = await import("./fees")
    const taxSettings = await getMerchantTaxSettings(merchantId)

    if (taxSettings.taxEnabled && taxSettings.taxRate > 0) {
      taxAmount = calculateTax(merchantAmount, taxSettings.taxRate)
    }

    const totalAmount = merchantAmount + taxAmount
    const pinetreeFee = input.pinetreeFee ?? 0.15
    const grossAmount = calculateGrossAmount(totalAmount, pinetreeFee)

    return {
      createPaymentInput: {
        amount: grossAmount,
        currency,
        provider: input.provider,
        merchantId,
        metadata: {
          ...(input.metadata || {}),
          terminalId: input.terminalId,
          merchantAmount,
          taxAmount,
          pinetreeFee,
          totalAmount
        }
      },
      breakdown: {
        merchantAmount,
        taxAmount,
        pinetreeFee,
        grossAmount
      }
    }
  } catch (error) {
    // If tax settings are unavailable, continue with default tax=0 behavior
    const { calculateGrossAmount } = await import("./fees")
    const totalAmount = merchantAmount
    const pinetreeFee = input.pinetreeFee ?? 0.15
    const grossAmount = calculateGrossAmount(totalAmount, pinetreeFee)

    if (error instanceof Error) {
      console.warn("Tax settings not available:", error)
    }

    return {
      createPaymentInput: {
        amount: grossAmount,
        currency,
        provider: input.provider,
        merchantId,
        metadata: {
          ...(input.metadata || {}),
          terminalId: input.terminalId,
          merchantAmount,
          taxAmount: 0,
          pinetreeFee,
          totalAmount
        }
      },
      breakdown: {
        merchantAmount,
        taxAmount: 0,
        pinetreeFee,
        grossAmount
      }
    }
  }
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

  // Fail fast for missing required env configuration
  validateConfigOnce()

  // Ensure all provider adapters are registered before selection/use
  await loadProviders()

  /* ---------------------------
     IDEMPOTENCY PROTECTION
  --------------------------- */

  if (input.idempotencyKey) {
    const existingPaymentId = await getIdempotencyKey(input.idempotencyKey)
    
    if (existingPaymentId) {
      const existingPayment = await getPaymentById(existingPaymentId)
      
      if (existingPayment) {
        const existingMetadata = (existingPayment.metadata || null) as StoredPaymentSplitMetadata | null
        return {
          id: existingPayment.id,
          provider: existingPayment.provider,
          paymentUrl: existingPayment.payment_url || "",
          qrCodeUrl: existingPayment.qr_code_url || "",
          address: String(existingMetadata?.split?.merchantWallet || ""),
          universalUrl: undefined
        }
      }
    }
  }

  /* ---------------------------
     PROVIDER SELECTION
  --------------------------- */

  let providerName = input.provider

  if (!providerName) {
    const selectedProvider = await chooseBestProvider(input.merchantId)
    providerName = selectedProvider as PaymentProvider
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

  const preferredNetwork =
    input.preferredNetwork ||
    providerToPreferredNetwork(providerName) || undefined

  const merchantWallet = await selectBestWallet(input.merchantId, preferredNetwork)
  
  if (!merchantWallet) {
    throw new Error("No wallet configured for merchant")
  }
  
  const merchantWalletAddress = merchantWallet.wallet_address
  const network = merchantWallet.network

  /* ---------------------------
     PINETREE TREASURY WALLET
  --------------------------- */

  assertTreasuryWalletFormat(network)
  const pinetreeWallet = getPineTreeTreasuryWallet(network)

  /* ---------------------------
     CREATE PAYMENT ID
  --------------------------- */

  const paymentId = crypto.randomUUID()

  /* ---------------------------
     GENERATE SPLIT PAYMENT
  --------------------------- */

  const splitPayment = await generateSplitPayment({
    merchantWallet: merchantWalletAddress,
    merchantAmount,
    pinetreeWallet,
    pinetreeFee,
    network,
    paymentId
  })

  /* ---------------------------
     INSERT PAYMENT RECORD
  --------------------------- */

  await createPaymentRecord({
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
    metadata: {
      ...(input.metadata || {}),
      split: {
        merchantWallet: merchantWalletAddress,
        pinetreeWallet,
        expectedAmountNative: splitPayment.nativeAmount,
        merchantNativeAmount: splitPayment.merchantNativeAmount,
        feeNativeAmount: splitPayment.feeNativeAmount,
        merchantNativeAmountAtomic: splitPayment.merchantNativeAmountAtomic,
        feeNativeAmountAtomic: splitPayment.feeNativeAmountAtomic
      }
    },
    status: "CREATED"
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

  await updatePaymentStatus(paymentId, "PENDING", {
    providerEvent: "payment.presented",
    rawPayload: {
      source: "createPayment"
    }
  })

  /* ---------------------------
     STORE IDEMPOTENCY KEY
  --------------------------- */

  if (input.idempotencyKey) {
    await storeIdempotencyKey(input.idempotencyKey, paymentId)
  }

  /* ---------------------------
     START PAYMENT WATCHER (BACKGROUND)
  --------------------------- */

  // Detach watcher to run asynchronously
  // Never block payment creation response
  // Watcher will handle timeout and status updates independently
  setTimeout(() => {
    void watchPayment({
      merchantWallet: merchantWalletAddress,
      pinetreeWallet,
      merchantAmount,
      pinetreeFee,
      expectedAmountNative: splitPayment.nativeAmount,
      expectedMerchantAtomic: splitPayment.merchantNativeAmountAtomic,
      expectedFeeAtomic: splitPayment.feeNativeAmountAtomic,
      network,
      paymentId
    }).catch(console.error)
  }, 0)

  /* ---------------------------
     RETURN RESULT
  --------------------------- */

  return {
    id: paymentId,
    provider: providerName,
    paymentUrl: splitPayment.paymentUrl,
    qrCodeUrl: splitPayment.qrCodeUrl,
    address: merchantWalletAddress,
    universalUrl: splitPayment.universalUrl
  }
}