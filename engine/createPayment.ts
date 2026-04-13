/**
 * PineTree Payment Creation
 * 
 * Central payment creation logic for the PineTree platform.
 * Handles the complete payment creation flow from validation to database storage.
 */

import { chooseBestAdapter } from "./providerSelector"
import { getProvider } from "./providerRegistry"
import { type PaymentAdapterId, getAdapterCredentialKey } from "@/types/payment"
import {
  createPayment as createPaymentRecord,
  createTransaction,
  claimIdempotencyKey,
  releaseIdempotencyKey,
  getPaymentById
} from "@/database"
import { generateSplitPayment } from "./generateSplitPayment"
import { calculateGrossAmount } from "./fees"
import { selectBestWallet } from "@/database/merchantWallets"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { loadProviders } from "./loadProviders"
import { normalizeWalletNetwork } from "./providerMappings"
import { watchPayment } from "./paymentWatcher"
import {
  PINETREE_FEE,
  getPineTreeTreasuryWallet,
  assertTreasuryWalletFormat,
  assertSplitRailConfig,
  validateConfigOnce
} from "./config"
import { getMerchantCredential } from "@/database/merchants"

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

async function getProviderApiKey(
  adapterId: string,
  merchantId: string
): Promise<string | undefined> {
  const credentialKey = getAdapterCredentialKey(adapterId)

  if (credentialKey) {
    return (await getMerchantCredential(merchantId, credentialKey)) || undefined
  }

  return undefined
}

type CreatePaymentInput = {
  amount: number
  currency: string
  adapterId?: PaymentAdapterId
  merchantId: string
  preferredNetwork?: string
  channel?: "pos" | "online" | "api" | "invoice"
  metadata?: PaymentMetadata
  idempotencyKey?: string
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
  adapterId?: PaymentAdapterId
  preferredNetwork?: string
  terminalId?: string
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

  let taxAmount = 0

  try {
    const { getMerchantTaxSettings } = await import("@/database/merchants")
    const { calculateTax, calculateGrossAmount } = await import("./fees")
    const taxSettings = await getMerchantTaxSettings(merchantId)

    if (taxSettings.taxEnabled && taxSettings.taxRate > 0) {
      taxAmount = calculateTax(merchantAmount, taxSettings.taxRate)
    }

    const totalAmount = merchantAmount + taxAmount
    const pinetreeFee = PINETREE_FEE
    const grossAmount = calculateGrossAmount(totalAmount, pinetreeFee)

    return {
      createPaymentInput: {
        amount: grossAmount,
        currency,
        adapterId: input.adapterId,
        merchantId,
        preferredNetwork: input.preferredNetwork,
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
    const pinetreeFee = PINETREE_FEE
    const grossAmount = calculateGrossAmount(totalAmount, pinetreeFee)

    if (error instanceof Error) {
      console.warn("Tax settings not available:", error)
    }

    return {
      createPaymentInput: {
        amount: grossAmount,
        currency,
        adapterId: input.adapterId,
        merchantId,
        preferredNetwork: input.preferredNetwork,
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

  const resolveExistingPaymentResult = async (existingPaymentId: string): Promise<CreatePaymentResult | null> => {
    const existingPayment = await getPaymentById(existingPaymentId)

    if (!existingPayment) {
      return null
    }

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

  const paymentId = crypto.randomUUID()
  let claimedIdempotencyKey = false

  if (input.idempotencyKey) {
    const claim = await claimIdempotencyKey(input.idempotencyKey, paymentId)
    if (claim.status === "existing") {
      const existingResult = await resolveExistingPaymentResult(claim.paymentId)
      if (existingResult) {
        return existingResult
      }
      throw new Error("Idempotency key exists but associated payment could not be loaded")
    }
    claimedIdempotencyKey = true
  }

  try {

  /* ---------------------------
     EXTRACT PINETREE FEE DATA
  --------------------------- */

  const merchantAmount = input.metadata?.merchantAmount ?? input.amount
  const pinetreeFee = Number(input.metadata?.pinetreeFee ?? PINETREE_FEE)
  const grossAmount = calculateGrossAmount(merchantAmount, pinetreeFee)

  /* ---------------------------
     RESOLVE NETWORK + MERCHANT WALLET
  --------------------------- */

  const preferredNetwork =
    normalizeWalletNetwork(input.preferredNetwork) ||
    normalizeWalletNetwork(String(input.metadata?.selectedNetwork || input.metadata?.network || "")) ||
    undefined

  const merchantWallet = await selectBestWallet(input.merchantId, preferredNetwork)
  
  if (!merchantWallet) {
    throw new Error("No wallet configured for merchant")
  }
  
  const merchantWalletAddress = merchantWallet.wallet_address
  const network = merchantWallet.network

  /* ---------------------------
     ADAPTER SELECTION
  --------------------------- */

  const providerName = await chooseBestAdapter({
    merchantId: input.merchantId,
    network,
    requestedAdapterId: input.adapterId
  })

  if (!providerName) {
    throw new Error(`No healthy payment adapter available for network: ${network}`)
  }

  const provider = getProvider(providerName)

  if (!provider.createPayment) {
    throw new Error(`Adapter ${providerName} does not implement createPayment`)
  }

  /* ---------------------------
     PINETREE TREASURY WALLET
  --------------------------- */

  assertTreasuryWalletFormat(network)
  assertSplitRailConfig(network)
  const pinetreeWallet = getPineTreeTreasuryWallet(network)

  /* ---------------------------
     CREATE PAYMENT ID
  --------------------------- */

  /* ---------------------------
     GENERATE SPLIT PAYMENT
  --------------------------- */

  // ✅ ENGINE NOW PASSES FULL SPLIT DATA TO PROVIDER
  // No more single amount, provider receives exact split values
  const providerApiKey = await getProviderApiKey(providerName, input.merchantId)
  const providerPayment = await provider.createPayment({
    paymentId: paymentId,
    merchantAmount,
    pinetreeFee,
    grossAmount,
    currency: input.currency,
    merchantWallet: merchantWalletAddress,
    pinetreeWallet,
    merchantId: input.merchantId,
    network,
    providerApiKey
  })

  const splitPayment = await generateSplitPayment({
    merchantWallet: merchantWalletAddress,
    merchantAmount,
    pinetreeWallet,
    pinetreeFee,
    network,
    paymentId,
    providerPayment
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
    provider_reference: providerPayment.providerReference,
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
    total_amount: Math.round(grossAmount * 100),
    status: "PENDING"
  })

  await updatePaymentStatus(paymentId, "PENDING", {
    providerEvent: "payment.presented",
    rawPayload: {
      source: "createPayment"
    }
  })

  // ✅ START PAYMENT WATCHER - THIS IS THE FINAL MISSING PIECE
  // Start background watcher to monitor blockchain for this payment
  setImmediate(async () => {
    try {
      await watchPayment({
        merchantWallet: merchantWalletAddress,
        pinetreeWallet: process.env.PINETREE_TREASURY_WALLET || "",
        merchantAmount: merchantAmount,
        pinetreeFee: pinetreeFee,
        expectedAmountNative: Number(splitPayment.nativeAmount || 0),
        expectedMerchantAtomic: splitPayment.merchantNativeAmountAtomic,
        expectedFeeAtomic: splitPayment.feeNativeAmountAtomic,
        feeCaptureMethod: splitPayment.feeCaptureMethod,

        network: network,
        paymentId: paymentId
      })
    } catch (error) {
      console.error("Payment watcher failed to start:", error)
    }
  })

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
  } catch (error) {
    if (claimedIdempotencyKey && input.idempotencyKey) {
      try {
        await releaseIdempotencyKey(input.idempotencyKey, paymentId)
      } catch (releaseError) {
        console.error("Failed to release idempotency key after payment creation failure:", releaseError)
      }
    }

    throw error
  }
}