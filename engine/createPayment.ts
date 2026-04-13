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
import { calculateGrossAmount } from "./fees"
import { selectBestWallet } from "@/database/merchantWallets"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { loadProviders } from "./loadProviders"
import { providerToPreferredNetwork } from "./providerMappings"
import {
  getPineTreeTreasuryWallet,
  assertTreasuryWalletFormat,
  assertSplitRailConfig,
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
    expectedAmountNative?: number
    merchantNativeAmount?: number
    feeNativeAmount?: number
  }
}

function inferNativeSymbolFromNetwork(network?: string): string | undefined {
  const normalized = String(network || "").toLowerCase().trim()
  if (normalized === "solana") return "SOL"
  if (normalized === "base" || normalized === "base_pay" || normalized === "ethereum") return "ETH"
  return undefined
}

function extractEvmSplitContractFromPaymentUrl(paymentUrl?: string): string | undefined {
  const raw = String(paymentUrl || "").trim()
  if (!raw.startsWith("ethereum:")) return undefined

  const withoutScheme = raw.slice("ethereum:".length)
  const contract = withoutScheme.split("@")[0]?.trim()
  if (!contract) return undefined

  return contract
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
  nativeAmount?: number
  nativeSymbol?: string
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
        const split = existingMetadata?.split
        const expectedAmountNative = Number(split?.expectedAmountNative || 0)
        const merchantNativeAmount = Number(split?.merchantNativeAmount || 0)
        const feeNativeAmount = Number(split?.feeNativeAmount || 0)

        const inferredNativeAmount =
          expectedAmountNative > 0
            ? expectedAmountNative
            : merchantNativeAmount + feeNativeAmount

        return {
          id: existingPayment.id,
          provider: existingPayment.provider,
          paymentUrl: existingPayment.payment_url || "",
          qrCodeUrl: existingPayment.qr_code_url || "",
          address: String(existingMetadata?.split?.merchantWallet || ""),
          universalUrl: undefined,
          nativeAmount: inferredNativeAmount > 0 ? inferredNativeAmount : undefined,
          nativeSymbol: inferNativeSymbolFromNetwork(existingPayment.network)
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
  assertSplitRailConfig(network)
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
        feeCaptureMethod: splitPayment.feeCaptureMethod,
        splitContract: extractEvmSplitContractFromPaymentUrl(splitPayment.paymentUrl),
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
    channel: channel,
    amount: grossAmount,
    status: "PENDING"
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
     RETURN RESULT
  --------------------------- */

  return {
    id: paymentId,
    provider: providerName,
    paymentUrl: splitPayment.paymentUrl,
    qrCodeUrl: splitPayment.qrCodeUrl,
    address: merchantWalletAddress,
    universalUrl: splitPayment.universalUrl,
    nativeAmount: Number(splitPayment.nativeAmount || 0),
    nativeSymbol: String(splitPayment.nativeSymbol || "").toUpperCase() || undefined
  }
}