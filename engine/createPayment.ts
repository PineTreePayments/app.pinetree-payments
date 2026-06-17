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
  validateConfigOnce
} from "./config"
import { getMerchantCredential } from "@/database/merchants"
import { getMerchantNwcUriForPayment } from "./lightningNwc"
import { getMerchantSpeedProvider, SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getMarketPricesUSD } from "./marketPrices"

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
  baseUsdcStrategy?: string
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

  // Propagate channel from metadata so online checkout links are tagged correctly
  const metadataChannel = String(input.metadata?.channel || "").trim() as
    | "pos" | "online" | "api" | "invoice" | ""
  const channel: "pos" | "online" | "api" | "invoice" | undefined =
    metadataChannel || undefined

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
        channel,
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
        channel,
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
  const isLightning = preferredNetwork === "bitcoin_lightning"
  const isProviderSettlement = isHostedCheckout || isLightning

  let merchantWalletAddress: string
  let network: string

  let walletAsset: string | undefined

  if (isProviderSettlement) {
    const providerSettlementNetwork = preferredNetwork || "shift4"
    merchantWalletAddress = `${providerSettlementNetwork}_${input.merchantId}`
    network = providerSettlementNetwork
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

  if (network === "bitcoin_lightning") {
    if (requestedAsset && requestedAsset !== "BTC") {
      throw new Error("Bitcoin Lightning payments support BTC only")
    }
    walletAsset = "btc-lightning"
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

  if (network === "bitcoin_lightning" && !provider.createLightningInvoice && !provider.createPayment) {
    throw new Error(`Adapter ${providerName} does not implement Lightning invoice creation`)
  }

  if (network !== "bitcoin_lightning" && !provider.createPayment) {
    throw new Error(`Adapter ${providerName} does not implement createPayment`)
  }

  /* ---------------------------
     PINETREE TREASURY WALLET
  --------------------------- */

  if (!isProviderSettlement) {
    assertTreasuryWalletFormat(network)
    assertSplitRailConfig(network)
  }
  const pinetreeWallet = isProviderSettlement ? "" : getPineTreeTreasuryWallet(network)

  /* ---------------------------
     CREATE PAYMENT ID
  --------------------------- */

  /* ---------------------------
     GENERATE SPLIT PAYMENT
  --------------------------- */

  // ✅ ENGINE NOW PASSES FULL SPLIT DATA TO PROVIDER
  // No more single amount, provider receives exact split values
  const providerApiKey = await getProviderApiKey(providerName, input.merchantId)

  // Resolve NWC URI from database before calling the provider.
  // The provider adapter must not query the database — all DB reads happen here in the engine.
  let nwcUri: string | undefined
  let btcPriceUsd: number | undefined
  let speedMerchantAccountId: string | undefined
  if (network === "bitcoin_lightning") {
    // Fetch BTC price for all Lightning paths so quotePriceUsd is stored for receipt display.
    const prices = await getMarketPricesUSD()
    btcPriceUsd = prices.BTC

    if (providerName === SPEED_PROVIDER_NAME) {
      const speedSetup = await getMerchantSpeedProvider(input.merchantId)
      if (!speedSetup?.accountId || !speedSetup.readyForPayments) {
        throw new Error("Speed Lightning is not ready. Save a merchant Speed Account ID and pass the PineTree Speed platform test.")
      }
      speedMerchantAccountId = speedSetup.accountId
      merchantWalletAddress = speedMerchantAccountId
    } else {
      const nwcSetup = await getMerchantNwcUriForPayment(input.merchantId)
      if (!nwcSetup) {
        throw new Error("Lightning wallet not connected. Please connect an NWC-compatible Lightning wallet in your dashboard.")
      }
      if (!nwcSetup.readiness.ready) {
        throw new Error(nwcSetup.readiness.reason || "Lightning wallet is connected but not ready for live payments.")
      }
      nwcUri = nwcSetup.nwcUri
    }
  }

  const providerPayment = network === "bitcoin_lightning" && provider.createLightningInvoice
    ? await provider.createLightningInvoice({
        paymentId,
        merchantAmount,
        pinetreeFee,
        grossAmount,
        currency: input.currency,
        merchantWallet: speedMerchantAccountId || merchantWalletAddress,
        pinetreeWallet,
        merchantId: input.merchantId,
        providerApiKey,
        nwcUri,
        btcPriceUsd,
        metadata: input.metadata
      })
    : await provider.createPayment!({
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

  const isBaseUsdcPayment = network === "base" && requestedAsset === "USDC"
  const baseUsdcStrategy = isBaseUsdcPayment ? "v7_eip3009_relayer" : undefined
  const isBaseV7Payment = isBaseUsdcPayment

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
  const paymentUrlKind = splitPayment.paymentUrl.startsWith("pinetree://base-v7")
    ? "pinetree://base-v7"
    : splitPayment.paymentUrl.startsWith("ethereum:")
      ? "ethereum:"
      : "other"

  if (isBaseUsdcPayment) {
    console.info("[payment:create][base-usdc] strategy resolved", {
      paymentId,
      selectedStrategy: baseUsdcStrategy,
      requestedStrategy: baseUsdcStrategy,
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
  const canonicalQrCodeUrl = network === "bitcoin_lightning"
    ? String((providerPayment as { qrCodeUrl?: string } | null)?.qrCodeUrl || splitPayment.qrCodeUrl)
    : providerHostedUrl
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
      selectedAsset: network === "solana" || network === "base" || network === "bitcoin_lightning" ? (requestedAsset || input.asset) : input.asset,
      split: {
        merchantWallet: merchantWalletAddress,
        pinetreeWallet,
        feeCaptureMethod: splitPayment.feeCaptureMethod,
        splitContract,
        expectedAmountNative: splitPayment.nativeAmount,
        nativeSymbol: splitPayment.nativeSymbol ?? null,
        quotePriceUsd: network === "bitcoin_lightning" && btcPriceUsd
          ? btcPriceUsd
          : splitPayment.quotePriceUsd ?? null,
        merchantNativeAmount: splitPayment.merchantNativeAmount,
        feeNativeAmount: splitPayment.feeNativeAmount,
        merchantNativeAmountAtomic: splitPayment.merchantNativeAmountAtomic,
        feeNativeAmountAtomic: splitPayment.feeNativeAmountAtomic,
        ...((providerPayment as { paymentHash?: string } | null)?.paymentHash
          ? { lightningPaymentHash: (providerPayment as { paymentHash?: string }).paymentHash }
          : {}),
        ...((providerPayment as { invoice?: string } | null)?.invoice
          ? { lightningInvoice: (providerPayment as { invoice?: string }).invoice }
          : {}),
        ...((providerPayment as { expiresAt?: string } | null)?.expiresAt
          ? { lightningExpiresAt: (providerPayment as { expiresAt?: string }).expiresAt }
          : {}),
        ...((network === "bitcoin_lightning" && (providerPayment as { metadata?: Record<string, unknown> } | null)?.metadata)
          ? { lightningProviderMetadata: (providerPayment as { metadata?: Record<string, unknown> }).metadata }
          : {}),
        ...(baseUsdcStrategy ? { baseUsdcStrategy } : {}),
        ...(isBaseV7Payment ? { baseVersion: "v7" as const } : {}),
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
