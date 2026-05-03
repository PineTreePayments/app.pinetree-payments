/**
 * PineTree Payment Creation
 * 
 * Central payment creation logic for the PineTree platform.
 * Handles the complete payment creation flow from validation to database storage.
 */

import { chooseBestAdapter } from "./providerSelector"
import { getProvider } from "./providerRegistry"
import { type BaseUsdcStrategy, type PaymentAdapterId, getAdapterCredentialKey } from "@/types/payment"
import {
  createPayment as createPaymentRecord,
  createTransaction,
  claimIdempotencyKey,
  releaseIdempotencyKey,
} from "@/database"
import { generateSplitPayment } from "./generateSplitPayment"
import { calculateGrossAmount } from "./fees"
import { selectBestWallet } from "@/database/merchantWallets"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { loadProviders } from "./loadProviders"
import { normalizeWalletNetwork } from "./providerMappings"
import {
  PINETREE_FEE,
  getPineTreeTreasuryWallet,
  assertTreasuryWalletFormat,
  assertSplitRailConfig,
  getBaseUsdcStrategy,
  isBaseUsdcV4Configured,
  validateConfigOnce
} from "./config"
import { getMerchantCredential } from "@/database/merchants"

type PaymentMetadata = {
  merchantAmount?: number
  pinetreeFee?: number
  [key: string]: unknown
}

export function inferNativeSymbolFromNetwork(network?: string): string | undefined {
  const normalized = String(network || "").toLowerCase().trim()
  if (normalized === "solana") return "SOL"
  if (normalized === "base" || normalized === "ethereum") return "ETH"
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

function buildSolanaPaymentUrl(paymentId: string): string {
  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL
  if (!BASE_URL || !BASE_URL.startsWith("https://")) {
    throw new Error("NEXT_PUBLIC_APP_URL must be set to a full https:// production domain")
  }
  const paymentUrl = `${BASE_URL}/api/solana-pay/transaction?paymentId=${paymentId}`
  console.log("FINAL SOLANA PAYMENT URL:", paymentUrl)
  return paymentUrl
}

function enforceNetworkPaymentUrl(network: string, paymentId: string, paymentUrl?: string): string {
  const normalizedNetwork = String(network || "").toLowerCase().trim()
  const normalizedPaymentUrl = String(paymentUrl || "").trim()

  if ((normalizeWalletNetwork(normalizedNetwork) || normalizedNetwork) === "solana") {
    const canonicalSolanaPaymentUrl = buildSolanaPaymentUrl(paymentId)
    return normalizedPaymentUrl === canonicalSolanaPaymentUrl
      ? normalizedPaymentUrl
      : canonicalSolanaPaymentUrl
  }

  return normalizedPaymentUrl
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
  asset?: string
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
  asset?: string
  baseUsdcStrategy?: BaseUsdcStrategy
}

export type BuildCreatePaymentRequestInput = {
  amount: number
  currency: string
  merchantId: string
  adapterId?: PaymentAdapterId
  preferredNetwork?: string
  asset?: string
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
        asset: input.asset,
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
        asset: input.asset,
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

  const paymentId = crypto.randomUUID()
  let claimedIdempotencyKey = false
  const requestedAsset = String(input.asset || input.metadata?.selectedAsset || "").trim().toUpperCase()

  if (input.idempotencyKey) {
    const claim = await claimIdempotencyKey(input.idempotencyKey, paymentId)
    if (claim.status === "existing") {
      throw new Error("Duplicate idempotency key. Start a new checkout attempt with a unique idempotency key.")
    } else {
      claimedIdempotencyKey = true
    }
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

  // Hosted-checkout providers (Shift4) don't use a blockchain wallet address.
  // Skip wallet lookup and treasury assertions — fee capture is handled by the provider.
  const isHostedCheckout = preferredNetwork === "shift4"

  let merchantWalletAddress: string
  let network: string

  let walletAsset: string | undefined

  if (isHostedCheckout) {
    merchantWalletAddress = `shift4_${input.merchantId}`
    network = "shift4"
  } else {
    const merchantWallet = await selectBestWallet(input.merchantId, preferredNetwork)

    if (!merchantWallet) {
      throw new Error("No wallet configured for merchant")
    }

    merchantWalletAddress = merchantWallet.wallet_address
    network = merchantWallet.network
    walletAsset = merchantWallet.asset || undefined
  }

  if (network === "solana") {
    if (requestedAsset !== "SOL" && requestedAsset !== "USDC") {
      throw new Error("Solana payments support SOL and USDC only")
    }
    walletAsset = requestedAsset === "USDC" ? "sol-usdc" : "sol"
  }

  if (network === "base") {
    if (requestedAsset && requestedAsset !== "ETH" && requestedAsset !== "USDC") {
      throw new Error("Base payments support ETH and USDC only")
    }
    walletAsset = requestedAsset === "USDC" ? "base-usdc" : "eth-base"
  }

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

  if (!isHostedCheckout) {
    assertTreasuryWalletFormat(network)
    assertSplitRailConfig(network)
  }
  const pinetreeWallet = isHostedCheckout ? "" : getPineTreeTreasuryWallet(network)

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

  // Use the provider's declared feeCaptureMethod if available.
  // This prevents network-based inference from overriding hosted-checkout providers
  // (e.g. Coinbase on "base" network → invoice_split, NOT contract_split).
  const providerDeclaredFeeMethod = String(
    (providerPayment as { feeCaptureMethod?: string } | null)?.feeCaptureMethod || ""
  ).trim() || undefined

  // Conservative Phase 2 strategy selection:
  // Base USDC V4 metadata is now supported, but the V4 frontend signature flow
  // and backend relayer routes are not wired yet. Keep live Base USDC payments
  // on the current V1 approve → splitToken fallback until those phases ship.
  const isBaseUsdcPayment = network === "base" && requestedAsset === "USDC"
  const requestedBaseUsdcStrategy = isBaseUsdcPayment
    ? getBaseUsdcStrategy()
    : undefined
  const isBaseUsdcV4ConfigValid = isBaseUsdcPayment ? isBaseUsdcV4Configured() : false
  const baseUsdcStrategy: BaseUsdcStrategy | undefined =
    requestedBaseUsdcStrategy === "v4_eip3009_relayer" && !isBaseUsdcV4ConfigValid
      ? "v1_approve_splitToken"
      : requestedBaseUsdcStrategy

  const splitPayment = await generateSplitPayment({
    merchantWallet: merchantWalletAddress,
    merchantAmount,
    pinetreeWallet,
    pinetreeFee,
    network,
    asset: walletAsset,
    paymentId,
    providerPayment,
    baseUsdcStrategy,
    feeCaptureMethodOverride: providerDeclaredFeeMethod
  })

  const splitContract = splitPayment.splitContract || extractEvmSplitContractFromPaymentUrl(splitPayment.paymentUrl)
  const paymentUrlKind = splitPayment.paymentUrl.startsWith("pinetree://base-usdc-v4")
    ? "pinetree://base-usdc-v4"
    : splitPayment.paymentUrl.startsWith("ethereum:")
      ? "ethereum:"
      : "other"

  if (isBaseUsdcPayment) {
    console.info("[payment:create][base-usdc] strategy resolved", {
      paymentId,
      selectedStrategy: baseUsdcStrategy,
      requestedStrategy: requestedBaseUsdcStrategy,
      isV4ConfigValid: isBaseUsdcV4ConfigValid,
      metadataBaseUsdcStrategy: baseUsdcStrategy,
      metadataSplitContract: splitContract,
      paymentUrlKind
    })
  }

  /* ---------------------------
     INSERT PAYMENT RECORD
  --------------------------- */

  // For hosted-checkout providers (Coinbase), the provider's own payment URL
  // (e.g. hosted Coinbase Commerce page) is the canonical payment URL.
  // For wallet-rail providers (Solana, Base Pay), use the split payment URI.
  const providerHostedUrl = String(
    (providerPayment as { paymentUrl?: string; hosted_url?: string } | null)?.paymentUrl ||
    (providerPayment as { hosted_url?: string } | null)?.hosted_url ||
    ""
  ).trim() || undefined

  const canonicalPaymentUrl = network === "solana"
    ? enforceNetworkPaymentUrl(network, paymentId, splitPayment.paymentUrl)
    : providerHostedUrl || splitPayment.paymentUrl
  const canonicalQrCodeUrl = providerHostedUrl
    ? splitPayment.qrCodeUrl  // QR still points to universalUrl so merchant can scan
    : splitPayment.qrCodeUrl

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
    payment_url: canonicalPaymentUrl,
    qr_code_url: canonicalQrCodeUrl,
    metadata: {
      ...(input.metadata || {}),
      selectedAsset: network === "solana" || network === "base" ? requestedAsset : input.asset,
      split: {
        merchantWallet: merchantWalletAddress,
        pinetreeWallet,
        feeCaptureMethod: splitPayment.feeCaptureMethod,
        splitContract,
        expectedAmountNative: splitPayment.nativeAmount,
        merchantNativeAmount: splitPayment.merchantNativeAmount,
        feeNativeAmount: splitPayment.feeNativeAmount,
        merchantNativeAmountAtomic: splitPayment.merchantNativeAmountAtomic,
        feeNativeAmountAtomic: splitPayment.feeNativeAmountAtomic,
        ...(baseUsdcStrategy ? { baseUsdcStrategy } : {}),
        ...((network === "solana" || network === "base") && requestedAsset === "USDC" ? { asset: "USDC" } : {})
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

  // Payment status is updated exclusively by the engine in response to:
  //   • Incoming webhooks  → app/api/webhooks/
  //   • Cron single-checks → app/api/cron/check-payments (calls checkPaymentOnce)
  // No background watcher is started here. Serverless functions must exit promptly.

  /* ---------------------------
     RETURN RESULT
  --------------------------- */

  // For contract_split payments, the user must send to the split contract — show that address.
  // For all other payment types, show the merchant's wallet address.
  const displayAddress =
    splitPayment.feeCaptureMethod === "contract_split" && splitContract
      ? splitContract
      : merchantWalletAddress

  console.info("[payment:create] returning paymentUrl", {
    paymentId,
    network,
    paymentUrl: canonicalPaymentUrl
  })

  return {
    id: paymentId,
    provider: providerName,
    paymentUrl: canonicalPaymentUrl,
    qrCodeUrl: canonicalQrCodeUrl,
    address: displayAddress,
    universalUrl: splitPayment.universalUrl,
    nativeAmount: Number(splitPayment.nativeAmount || 0),
    nativeSymbol: String(splitPayment.nativeSymbol || "").toUpperCase() || undefined,
    asset: network === "solana" || network === "base" ? requestedAsset : input.asset,
    baseUsdcStrategy
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