import {
  createOffRampSessionDraft,
  getOffRampSessionByExternalTransactionId,
  getOffRampSessionByProviderSessionId,
  getOffRampSessionForMerchant,
  listOffRampSessionsForMerchant as listOffRampSessionRowsForMerchant,
  recordOffRampEvent,
  updateOffRampSessionFromProviderStatus,
  updateOffRampSessionQuote,
  updateOffRampSessionStatus,
  type OffRampSessionRecord
} from "@/database/offRampSessions"
import { moonPayOffRampAdapter } from "@/providers/offramp"
import {
  OffRampProviderError,
  type OffRampDepositInstruction,
  type OffRampProviderWebhookEvent,
  type OffRampProviderQuote,
  type OffRampProviderWidgetUrl
} from "@/providers/offramp/types"

export type OffRampProvider = "moonpay" | "ramp" | "banxa" | "transak"
export type OffRampNetwork = "base" | "solana" | "lightning"
export type OffRampAsset = "ETH" | "USDC" | "SOL" | "BTC"

export type OffRampSessionStatus =
  | "CREATED"
  | "SETUP_REQUIRED"
  | "QUOTE_READY"
  | "AWAITING_APPROVAL"
  | "AWAITING_CRYPTO"
  | "SUBMITTED"
  | "PROCESSING"
  | "PAYOUT_INITIATED"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"

export type OffRampQuoteRequest = {
  provider: OffRampProvider
  network: OffRampNetwork
  asset: OffRampAsset
  amount: number
  fiatCurrency?: string
  merchantState?: string | null
}

export type OffRampSessionDraftRequest = OffRampQuoteRequest & {
  merchantId: string
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  payoutMethod?: string | null
  providerSetupActive?: boolean
}

export type OffRampSessionSummary = {
  id: string
  merchantId: string
  provider: OffRampProvider
  asset: OffRampAsset
  network: OffRampNetwork
  cryptoAmount: number | null
  quoteFiatAmount: number | null
  quoteFiatCurrency: string
  status: OffRampSessionStatus
  providerStatus: string | null
  sourceWalletAddress: string | null
  refundWalletAddress: string | null
  payoutMethod: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type OffRampQuoteSummary = Omit<OffRampProviderQuote, "rawProviderResponse">

export type OffRampQuoteForMerchantRequest = OffRampQuoteRequest & {
  merchantId: string
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  payoutMethod?: string | null
}

export type PrepareOffRampSessionRequest = {
  merchantId: string
  sessionId: string
  merchantState?: string | null
  payoutMethod?: string | null
}

export type CreateOffRampWidgetLaunchRequest = {
  merchantId: string
  sessionId: string
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  redirectPath?: string | null
  merchantState?: string | null
}

export type OffRampSessionScopedRequest = {
  merchantId: string
  sessionId: string
}

export type OffRampDepositInstructionPreview = {
  session: OffRampSessionSummary
  provider: OffRampProvider
  instructionReady: boolean
  network: OffRampNetwork
  asset: OffRampAsset
  amount: number
  depositAddress: string | null
  memo: string | null
  destinationTag: string | null
  expiresAt: string | null
  rawStatus: string | null
  approvalReady: boolean
  message: string
  fundMovementEnabled: false
  nextStep: "WAIT_FOR_MOONPAY_DEPOSIT_INSTRUCTIONS"
}

export type OffRampWalletApprovalPreview = {
  session: OffRampSessionSummary
  approvalReady: boolean
  fromWalletAddress: string | null
  destinationAddress: string | null
  asset: OffRampAsset
  amount: number
  network: OffRampNetwork
  estimatedNetworkFee: null
  message: string
  instructionReady: boolean
  fundMovementEnabled: false
  signablePayload: null
  nextStep: "WAIT_FOR_MOONPAY_DEPOSIT_INSTRUCTIONS" | "MERCHANT_APPROVES_WALLET_TRANSFER"
}

export type ProcessOffRampProviderWebhookInput = {
  provider: OffRampProvider
  rawBody: string
  signature?: string | null
}

export type ProcessOffRampProviderWebhookResult = {
  processed: boolean
  matchedSession: boolean
  sessionId?: string
  statusUpdate?: OffRampSessionStatus | null
  providerStatus?: string | null
  fundMovementEnabled: false
}

export type OffRampAssetSupportResult = {
  supported: boolean
  restricted?: boolean
  reason?: string
  moonPayCode?: string
}

export const SUPPORTED_MOONPAY_OFF_RAMP_ASSETS: Array<{
  network: Extract<OffRampNetwork, "base" | "solana">
  asset: Extract<OffRampAsset, "ETH" | "USDC" | "SOL">
  moonPayCode: string
}> = [
  { network: "solana", asset: "USDC", moonPayCode: "usdc_sol" },
  { network: "solana", asset: "SOL", moonPayCode: "sol" },
  { network: "base", asset: "USDC", moonPayCode: "usdc_base" },
  { network: "base", asset: "ETH", moonPayCode: "eth_base" }
]

export const MOONPAY_OFF_RAMP_DISCLAIMERS = [
  "Cash-out availability varies by state, asset, network, and payout method.",
  "Base network cash-out may not be available for New York residents through MoonPay."
]

const VALID_PROVIDERS: OffRampProvider[] = ["moonpay", "ramp", "banxa", "transak"]
const VALID_NETWORKS: OffRampNetwork[] = ["base", "solana", "lightning"]
const VALID_ASSETS: OffRampAsset[] = ["ETH", "USDC", "SOL", "BTC"]

function normalizeProvider(value: unknown): OffRampProvider {
  const normalized = String(value || "moonpay").trim().toLowerCase()
  if (VALID_PROVIDERS.includes(normalized as OffRampProvider)) {
    return normalized as OffRampProvider
  }
  throw new Error(`Unsupported off-ramp provider: ${normalized || "unknown"}`)
}

function normalizeNetwork(value: unknown): OffRampNetwork {
  const normalized = String(value || "").trim().toLowerCase()
  if (VALID_NETWORKS.includes(normalized as OffRampNetwork)) {
    return normalized as OffRampNetwork
  }
  throw new Error(`Unsupported off-ramp network: ${normalized || "unknown"}`)
}

function normalizeAsset(value: unknown): OffRampAsset {
  const normalized = String(value || "").trim().toUpperCase()
  if (VALID_ASSETS.includes(normalized as OffRampAsset)) {
    return normalized as OffRampAsset
  }
  throw new Error(`Unsupported off-ramp asset: ${normalized || "unknown"}`)
}

function normalizeMerchantState(value: unknown): string | null {
  const normalized = String(value || "").trim().toUpperCase()
  return normalized || null
}

function toSummary(row: OffRampSessionRecord): OffRampSessionSummary {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    provider: row.provider as OffRampProvider,
    asset: row.asset as OffRampAsset,
    network: row.network as OffRampNetwork,
    cryptoAmount: row.crypto_amount,
    quoteFiatAmount: row.quote_fiat_amount,
    quoteFiatCurrency: row.quote_fiat_currency,
    status: row.status as OffRampSessionStatus,
    providerStatus: row.provider_status,
    sourceWalletAddress: row.source_wallet_address,
    refundWalletAddress: row.refund_wallet_address,
    payoutMethod: row.payout_method,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toQuoteSummary(quote: OffRampProviderQuote): OffRampQuoteSummary {
  return {
    provider: quote.provider,
    moonPayCode: quote.moonPayCode,
    asset: quote.asset,
    network: quote.network,
    cryptoAmount: quote.cryptoAmount,
    fiatCurrency: quote.fiatCurrency,
    quoteFiatAmount: quote.quoteFiatAmount,
    providerFeeAmount: quote.providerFeeAmount,
    platformFeeAmount: quote.platformFeeAmount,
    totalFeeAmount: quote.totalFeeAmount,
    payoutMethod: quote.payoutMethod,
    quoteExpiresAt: quote.quoteExpiresAt
  }
}

function getProviderAdapter(provider: OffRampProvider) {
  if (provider === "moonpay") return moonPayOffRampAdapter
  throw new OffRampProviderError(
    "Only MoonPay off-ramp support is planned for this phase.",
    "OFF_RAMP_PROVIDER_UNSUPPORTED",
    400
  )
}

function getProviderErrorStatus(error: unknown) {
  if (error instanceof OffRampProviderError) return error.status
  return 400
}

function providerCallAttempted(error: unknown) {
  if (!(error instanceof OffRampProviderError)) return true
  return !error.message.toLowerCase().includes("not configured")
}

function getAppBaseUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "")
    .trim()
    .replace(/\/+$/, "")
}

function createOffRampRedirectUrl(sessionId: string, redirectPath?: string | null) {
  const appBaseUrl = getAppBaseUrl()
  if (!appBaseUrl || !appBaseUrl.startsWith("https://")) {
    throw new OffRampProviderError(
      "MoonPay widget launch requires NEXT_PUBLIC_APP_URL or APP_URL to be a full HTTPS URL.",
      "OFF_RAMP_PROVIDER_DISABLED",
      503
    )
  }

  const normalizedPath = String(redirectPath || "/dashboard/wallets").trim()
  const safePath = normalizedPath.startsWith("/") && !normalizedPath.startsWith("//")
    ? normalizedPath
    : "/dashboard/wallets"
  const url = new URL(safePath, appBaseUrl)
  url.searchParams.set("offRampSessionId", sessionId)
  url.searchParams.set("provider", "moonpay")
  return url.toString()
}

function validateDepositPreviewStatus(status: OffRampSessionStatus) {
  return status === "QUOTE_READY" ||
    status === "AWAITING_APPROVAL" ||
    status === "AWAITING_CRYPTO"
}

function getDepositPreviewMessage(status: OffRampSessionStatus, instruction: OffRampDepositInstruction) {
  if (instruction.instructionReady) {
    return "MoonPay deposit instructions are available for wallet approval preview."
  }

  if (status === "QUOTE_READY") {
    return "MoonPay flow has not been completed yet. Open MoonPay before checking deposit instructions."
  }

  return instruction.message || "Waiting for MoonPay deposit instructions."
}

function getStringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  const normalized = String(value ?? "").trim()
  return normalized || null
}

function getStoredDepositInstruction(row: OffRampSessionRecord): OffRampDepositInstruction | null {
  const depositAddress = getStringMetadata(row.metadata, "depositAddress")
  const instructionReady = row.metadata.depositInstructionReady === true && Boolean(depositAddress)
  if (!instructionReady) return null

  return {
    provider: row.provider as OffRampProvider,
    providerSessionId: row.provider_session_id,
    externalTransactionId: row.external_transaction_id,
    network: row.network as OffRampNetwork,
    asset: row.asset as OffRampAsset,
    amount: Number(row.crypto_amount || 0),
    depositAddress,
    memo: getStringMetadata(row.metadata, "depositMemo"),
    destinationTag: getStringMetadata(row.metadata, "depositDestinationTag"),
    expiresAt: getStringMetadata(row.metadata, "depositInstructionExpiresAt"),
    rawStatus: row.provider_status,
    instructionReady: true,
    message: "MoonPay deposit instructions are available for wallet approval preview.",
    fundMovementEnabled: false
  }
}

function providerStatusIndicatesFailure(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  return ["failed", "cancelled", "canceled", "expired", "rejected"].some((needle) =>
    normalized.includes(needle)
  )
}

function providerStatusIndicatesWaitingForCrypto(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  return ["waiting", "deposit", "pending_crypto", "awaiting"].some((needle) =>
    normalized.includes(needle)
  )
}

function providerStatusIndicatesCompleted(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  return ["complete", "completed", "succeeded", "settled"].some((needle) =>
    normalized.includes(needle)
  )
}

function getWebhookStatusUpdate(event: OffRampProviderWebhookEvent): OffRampSessionStatus | null {
  if (providerStatusIndicatesFailure(event.providerStatus)) return "FAILED"
  if (event.depositAddress || providerStatusIndicatesWaitingForCrypto(event.providerStatus)) {
    return "AWAITING_CRYPTO"
  }
  if (providerStatusIndicatesCompleted(event.providerStatus)) return "PROCESSING"
  if (event.providerStatus) return "PROCESSING"
  return null
}

export function validateOffRampAssetSupport(input: {
  provider: OffRampProvider
  network: OffRampNetwork
  asset: OffRampAsset
  merchantState?: string | null
}): OffRampAssetSupportResult {
  if (input.provider !== "moonpay") {
    return {
      supported: false,
      reason: "Only MoonPay off-ramp support is planned for this phase."
    }
  }

  if (input.network === "lightning" || input.asset === "BTC") {
    return {
      supported: false,
      reason: "MoonPay cash-out for Bitcoin Lightning is not enabled yet."
    }
  }

  if (normalizeMerchantState(input.merchantState) === "NY" && input.network === "base") {
    return {
      supported: false,
      restricted: true,
      reason: "Base network cash-out may not be available for New York residents through MoonPay."
    }
  }

  const supportedAsset = SUPPORTED_MOONPAY_OFF_RAMP_ASSETS.find(
    (item) => item.network === input.network && item.asset === input.asset
  )

  if (!supportedAsset) {
    return {
      supported: false,
      reason: "This asset and network are not supported for MoonPay cash-out yet."
    }
  }

  return {
    supported: true,
    moonPayCode: supportedAsset.moonPayCode
  }
}

export function getMoonPayOffRampSupportMatrix() {
  return {
    provider: "moonpay" as const,
    supportedAssets: SUPPORTED_MOONPAY_OFF_RAMP_ASSETS,
    restrictions: [
      {
        network: "base" as const,
        merchantState: "NY",
        message: "Base network cash-out may not be available for New York residents through MoonPay."
      },
      {
        network: "lightning" as const,
        asset: "BTC" as const,
        message: "MoonPay cash-out for Bitcoin Lightning is not enabled yet."
      }
    ],
    disclaimers: MOONPAY_OFF_RAMP_DISCLAIMERS,
    providerCallsEnabled: false,
    fundMovementEnabled: false
  }
}

export async function createOffRampSessionDraftForMerchant(input: OffRampSessionDraftRequest): Promise<{
  session: OffRampSessionSummary
  support: OffRampAssetSupportResult
  rejected: boolean
}> {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Error("Missing merchant ID")
  }

  const provider = normalizeProvider(input.provider)
  const network = normalizeNetwork(input.network)
  const asset = normalizeAsset(input.asset)
  const amount = Number(input.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid off-ramp amount")
  }

  const merchantState = normalizeMerchantState(input.merchantState)
  const support = validateOffRampAssetSupport({
    provider,
    network,
    asset,
    merchantState
  })

  const rejected = !support.supported
  const status: OffRampSessionStatus = rejected
    ? "FAILED"
    : input.providerSetupActive
      ? "CREATED"
      : "SETUP_REQUIRED"

  const session = await createOffRampSessionDraft({
    merchantId,
    provider,
    asset,
    network,
    cryptoAmount: amount,
    quoteFiatCurrency: input.fiatCurrency || "USD",
    sourceWalletAddress: input.sourceWalletAddress || null,
    refundWalletAddress: input.refundWalletAddress || input.sourceWalletAddress || null,
    payoutMethod: input.payoutMethod || null,
    status,
    errorCode: rejected ? "OFF_RAMP_UNSUPPORTED" : null,
    errorMessage: rejected ? support.reason || "Unsupported off-ramp request" : null,
    metadata: {
      merchantState,
      moonPayCode: support.moonPayCode || null,
      providerCallsEnabled: false,
      fundMovementEnabled: false,
      phase: "moonpay_off_ramp_phase_1"
    }
  })

  await recordOffRampEvent({
    sessionId: session.id,
    merchantId,
    eventType: rejected ? "off_ramp.session.rejected" : "off_ramp.session.created",
    provider,
    providerStatus: null,
    rawPayload: {
      provider,
      network,
      asset,
      amount,
      merchantState,
      support,
      providerCallsEnabled: false,
      fundMovementEnabled: false
    }
  })

  return {
    session: toSummary(session),
    support,
    rejected
  }
}

export async function getOffRampQuoteForMerchant(input: OffRampQuoteForMerchantRequest): Promise<{
  session: OffRampSessionSummary
  quote: OffRampQuoteSummary | null
  support: OffRampAssetSupportResult
  providerCallsEnabled: boolean
}> {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Error("Missing merchant ID")
  }

  const provider = normalizeProvider(input.provider)
  const network = normalizeNetwork(input.network)
  const asset = normalizeAsset(input.asset)
  const amount = Number(input.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid off-ramp amount")
  }

  const merchantState = normalizeMerchantState(input.merchantState)
  const support = validateOffRampAssetSupport({
    provider,
    network,
    asset,
    merchantState
  })
  const session = await createOffRampSessionDraft({
    merchantId,
    provider,
    asset,
    network,
    cryptoAmount: amount,
    quoteFiatCurrency: input.fiatCurrency || "USD",
    sourceWalletAddress: input.sourceWalletAddress || null,
    refundWalletAddress: input.refundWalletAddress || input.sourceWalletAddress || null,
    payoutMethod: input.payoutMethod || "ach_bank_transfer",
    status: support.supported ? "CREATED" : "FAILED",
    errorCode: support.supported ? null : "OFF_RAMP_UNSUPPORTED",
    errorMessage: support.supported ? null : support.reason || "Unsupported off-ramp request",
    metadata: {
      merchantState,
      moonPayCode: support.moonPayCode || null,
      providerCallsEnabled: false,
      fundMovementEnabled: false,
      phase: "moonpay_off_ramp_phase_2"
    }
  })

  await recordOffRampEvent({
    sessionId: session.id,
    merchantId,
    eventType: "off_ramp.quote.requested",
    provider,
    rawPayload: {
      provider,
      network,
      asset,
      amount,
      merchantState,
      support,
      fundMovementEnabled: false
    }
  })

  if (!support.supported) {
    await recordOffRampEvent({
      sessionId: session.id,
      merchantId,
      eventType: "off_ramp.quote.failed",
      provider,
      rawPayload: {
        reason: support.reason,
        restricted: support.restricted === true,
        providerCallsEnabled: false,
        fundMovementEnabled: false
      }
    })

    return {
      session: toSummary(session),
      quote: null,
      support,
      providerCallsEnabled: false
    }
  }

  try {
    const adapter = getProviderAdapter(provider)
    const quote = await adapter.getQuote({
      provider,
      network,
      asset,
      amount,
      fiatCurrency: input.fiatCurrency || "USD",
      payoutMethod: input.payoutMethod || "ach_bank_transfer",
      extraFeePercentage: 0
    })
    const updated = await updateOffRampSessionQuote({
      merchantId,
      sessionId: session.id,
      status: "QUOTE_READY",
      cryptoAmount: quote.cryptoAmount,
      quoteFiatAmount: quote.quoteFiatAmount,
      quoteFiatCurrency: quote.fiatCurrency,
      quoteFeeAmount: quote.providerFeeAmount,
      platformFeeAmount: quote.platformFeeAmount,
      quoteExpiresAt: quote.quoteExpiresAt,
      payoutMethod: quote.payoutMethod,
      providerStatus: "quote_ready",
      errorCode: null,
      errorMessage: null,
      metadata: {
        merchantState,
        moonPayCode: quote.moonPayCode,
        providerCallsEnabled: true,
        fundMovementEnabled: false,
        quoteFetchedAt: new Date().toISOString()
      }
    })

    await recordOffRampEvent({
      sessionId: session.id,
      merchantId,
      eventType: "off_ramp.quote.ready",
      provider,
      providerStatus: "quote_ready",
      rawPayload: {
        quote: toQuoteSummary(quote),
        providerCallsEnabled: true,
        fundMovementEnabled: false
      }
    })

    return {
      session: toSummary(updated),
      quote: toQuoteSummary(quote),
      support,
      providerCallsEnabled: true
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Off-ramp quote failed"
    const code = error instanceof OffRampProviderError
      ? error.code
      : "OFF_RAMP_PROVIDER_REQUEST_FAILED"
    const attemptedProviderCall = providerCallAttempted(error)
    const updated = await updateOffRampSessionStatus({
      merchantId,
      sessionId: session.id,
      status: "FAILED",
      providerStatus: "quote_failed",
      errorCode: code,
      errorMessage: message,
      metadata: {
        merchantState,
        moonPayCode: support.moonPayCode || null,
        providerCallsEnabled: attemptedProviderCall,
        fundMovementEnabled: false,
        quoteFailedAt: new Date().toISOString()
      }
    })

    await recordOffRampEvent({
      sessionId: session.id,
      merchantId,
      eventType: "off_ramp.quote.failed",
      provider,
      providerStatus: "quote_failed",
      rawPayload: {
        errorCode: code,
        errorMessage: message,
        providerErrorStatus: getProviderErrorStatus(error),
        providerCallsEnabled: attemptedProviderCall,
        fundMovementEnabled: false
      }
    })

    return {
      session: toSummary(updated),
      quote: null,
      support,
      providerCallsEnabled: attemptedProviderCall
    }
  }
}

export async function prepareOffRampSessionForMerchant(
  input: PrepareOffRampSessionRequest
): Promise<{
  session: OffRampSessionSummary
  quote: OffRampQuoteSummary | null
  preparation: {
    implemented: boolean
    status: "NOT_IMPLEMENTED" | "PREPARED" | "QUOTE_READY" | "FAILED"
    message: string
  }
  providerCallsEnabled: boolean
}> {
  const merchantId = String(input.merchantId || "").trim()
  const sessionId = String(input.sessionId || "").trim()
  if (!merchantId) throw new Error("Missing merchant ID")
  if (!sessionId) throw new Error("Missing off-ramp session ID")

  const existing = await getOffRampSessionForMerchant(merchantId, sessionId)
  if (!existing) {
    throw new Error("Off-ramp session not found")
  }

  const provider = normalizeProvider(existing.provider)
  const network = normalizeNetwork(existing.network)
  const asset = normalizeAsset(existing.asset)
  const amount = Number(existing.crypto_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid off-ramp amount")
  }

  const merchantState = normalizeMerchantState(input.merchantState || existing.metadata.merchantState)
  const support = validateOffRampAssetSupport({
    provider,
    network,
    asset,
    merchantState
  })

  if (!support.supported) {
    const updated = await updateOffRampSessionStatus({
      merchantId,
      sessionId,
      status: "FAILED",
      providerStatus: "prepare_rejected",
      errorCode: "OFF_RAMP_UNSUPPORTED",
      errorMessage: support.reason || "Unsupported off-ramp request",
      metadata: {
        ...existing.metadata,
        merchantState,
        providerCallsEnabled: false,
        fundMovementEnabled: false,
        prepareRejectedAt: new Date().toISOString()
      }
    })

    await recordOffRampEvent({
      sessionId,
      merchantId,
      eventType: "off_ramp.quote.failed",
      provider,
      providerStatus: "prepare_rejected",
      rawPayload: {
        support,
        providerCallsEnabled: false,
        fundMovementEnabled: false
      }
    })

    return {
      session: toSummary(updated),
      quote: null,
      preparation: {
        implemented: false,
        status: "NOT_IMPLEMENTED",
        message: support.reason || "Unsupported off-ramp request"
      },
      providerCallsEnabled: false
    }
  }

  await recordOffRampEvent({
    sessionId,
    merchantId,
    eventType: "off_ramp.quote.requested",
    provider,
    rawPayload: {
      provider,
      network,
      asset,
      amount,
      providerCallsEnabled: true,
      fundMovementEnabled: false
    }
  })

  const adapter = getProviderAdapter(provider)
  let quote: OffRampProviderQuote

  try {
    quote = await adapter.getQuote({
      provider,
      network,
      asset,
      amount,
      fiatCurrency: existing.quote_fiat_currency || "USD",
      payoutMethod: input.payoutMethod || existing.payout_method || "ach_bank_transfer",
      extraFeePercentage: 0
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Off-ramp quote failed"
    const code = error instanceof OffRampProviderError
      ? error.code
      : "OFF_RAMP_PROVIDER_REQUEST_FAILED"
    const attemptedProviderCall = providerCallAttempted(error)
    const failed = await updateOffRampSessionStatus({
      merchantId,
      sessionId,
      status: "FAILED",
      providerStatus: "quote_failed",
      errorCode: code,
      errorMessage: message,
      metadata: {
        ...existing.metadata,
        merchantState,
        moonPayCode: support.moonPayCode || null,
        providerCallsEnabled: attemptedProviderCall,
        fundMovementEnabled: false,
        quoteFailedAt: new Date().toISOString()
      }
    })

    await recordOffRampEvent({
      sessionId,
      merchantId,
      eventType: "off_ramp.quote.failed",
      provider,
      providerStatus: "quote_failed",
      rawPayload: {
        errorCode: code,
        errorMessage: message,
        providerErrorStatus: getProviderErrorStatus(error),
        providerCallsEnabled: attemptedProviderCall,
        fundMovementEnabled: false
      }
    })

    return {
      session: toSummary(failed),
      quote: null,
      preparation: {
        implemented: false,
        status: "FAILED",
        message
      },
      providerCallsEnabled: attemptedProviderCall
    }
  }

  const updated = await updateOffRampSessionQuote({
    merchantId,
    sessionId,
    status: "QUOTE_READY",
    cryptoAmount: quote.cryptoAmount,
    quoteFiatAmount: quote.quoteFiatAmount,
    quoteFiatCurrency: quote.fiatCurrency,
    quoteFeeAmount: quote.providerFeeAmount,
    platformFeeAmount: quote.platformFeeAmount,
    quoteExpiresAt: quote.quoteExpiresAt,
    payoutMethod: quote.payoutMethod,
    providerStatus: "quote_ready",
    errorCode: null,
    errorMessage: null,
    metadata: {
      ...existing.metadata,
      merchantState,
      moonPayCode: quote.moonPayCode,
      providerCallsEnabled: true,
      fundMovementEnabled: false,
      quoteFetchedAt: new Date().toISOString()
    }
  })

  await recordOffRampEvent({
    sessionId,
    merchantId,
    eventType: "off_ramp.quote.ready",
    provider,
    providerStatus: "quote_ready",
    rawPayload: {
      quote: toQuoteSummary(quote),
      providerCallsEnabled: true,
      fundMovementEnabled: false
    }
  })

  try {
    const preparation = await adapter.createSession({
      sessionId,
      merchantId,
      quote,
      sourceWalletAddress: updated.source_wallet_address,
      refundWalletAddress: updated.refund_wallet_address
    })

    await recordOffRampEvent({
      sessionId,
      merchantId,
      eventType: "off_ramp.session.prepared",
      provider,
      rawPayload: {
        preparation,
        providerCallsEnabled: true,
        fundMovementEnabled: false
      }
    })

    return {
      session: toSummary(updated),
      quote: toQuoteSummary(quote),
      preparation: {
        implemented: preparation.implemented,
        status: preparation.status,
        message: preparation.message
      },
      providerCallsEnabled: true
    }
  } catch (error: unknown) {
    if (error instanceof OffRampProviderError && error.code === "OFF_RAMP_PROVIDER_NOT_IMPLEMENTED") {
      await recordOffRampEvent({
        sessionId,
        merchantId,
        eventType: "off_ramp.session.prepare_not_implemented",
        provider,
        rawPayload: {
          message: error.message,
          providerCallsEnabled: false,
          fundMovementEnabled: false
        }
      })

      return {
        session: toSummary(updated),
        quote: toQuoteSummary(quote),
        preparation: {
          implemented: false,
          status: "NOT_IMPLEMENTED",
          message: error.message
        },
        providerCallsEnabled: true
      }
    }

    throw error
  }
}

export async function createOffRampWidgetLaunchForMerchant(
  input: CreateOffRampWidgetLaunchRequest
): Promise<{
  session: OffRampSessionSummary
  widgetUrl: string
  provider: OffRampProvider
  signed: boolean
  expiresAt?: string | null
  providerCallsEnabled: boolean
  fundMovementEnabled: false
  nextStep: "MERCHANT_COMPLETES_MOONPAY_FLOW"
}> {
  const merchantId = String(input.merchantId || "").trim()
  const sessionId = String(input.sessionId || "").trim()
  if (!merchantId) throw new Error("Missing merchant ID")
  if (!sessionId) throw new Error("Missing off-ramp session ID")

  const existing = await getOffRampSessionForMerchant(merchantId, sessionId)
  if (!existing) {
    throw new Error("Off-ramp session not found")
  }

  const provider = normalizeProvider(existing.provider)
  const network = normalizeNetwork(existing.network)
  const asset = normalizeAsset(existing.asset)
  const amount = Number(existing.crypto_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid off-ramp amount")
  }

  if (existing.status !== "QUOTE_READY" && existing.status !== "AWAITING_APPROVAL") {
    throw new Error("Off-ramp session must have a ready quote before launching MoonPay.")
  }

  const merchantState = normalizeMerchantState(input.merchantState || existing.metadata.merchantState)
  const support = validateOffRampAssetSupport({
    provider,
    network,
    asset,
    merchantState
  })

  if (!support.supported || !support.moonPayCode) {
    throw new Error(support.reason || "Unsupported off-ramp request")
  }

  const adapter = getProviderAdapter(provider)
  const redirectUrl = createOffRampRedirectUrl(sessionId, input.redirectPath)
  const widget: OffRampProviderWidgetUrl = await adapter.createWidgetUrl({
    sessionId,
    merchantId,
    network,
    asset,
    moonPayCode: support.moonPayCode,
    cryptoAmount: amount,
    fiatCurrency: existing.quote_fiat_currency || "USD",
    payoutMethod: existing.payout_method || "ach_bank_transfer",
    sourceWalletAddress: input.sourceWalletAddress || existing.source_wallet_address,
    refundWalletAddress: input.refundWalletAddress || existing.refund_wallet_address,
    redirectUrl
  })

  const updated = await updateOffRampSessionStatus({
    merchantId,
    sessionId,
    status: "AWAITING_APPROVAL",
    providerStatus: "widget_prepared",
    errorCode: null,
    errorMessage: null,
    metadata: {
      ...existing.metadata,
      merchantState,
      widgetLaunchPrepared: true,
      providerCallsEnabled: true,
      fundMovementEnabled: false,
      moonPayCode: support.moonPayCode,
      redirectUrl,
      signed: widget.signed,
      widgetPreparedAt: new Date().toISOString()
    }
  })

  await recordOffRampEvent({
    sessionId,
    merchantId,
    eventType: "off_ramp.widget.prepared",
    provider,
    providerStatus: "widget_prepared",
    rawPayload: {
      provider,
      network,
      asset,
      moonPayCode: support.moonPayCode,
      signed: widget.signed,
      redirectUrl,
      providerCallsEnabled: true,
      fundMovementEnabled: false,
      nextStep: "MERCHANT_COMPLETES_MOONPAY_FLOW"
    }
  })

  return {
    session: toSummary(updated),
    widgetUrl: widget.widgetUrl,
    provider,
    signed: widget.signed,
    expiresAt: widget.expiresAt,
    providerCallsEnabled: true,
    fundMovementEnabled: false,
    nextStep: "MERCHANT_COMPLETES_MOONPAY_FLOW"
  }
}

export async function getOffRampDepositInstructionPreviewForMerchant(
  input: OffRampSessionScopedRequest,
  recordPreviewEvent = true
): Promise<OffRampDepositInstructionPreview> {
  const merchantId = String(input.merchantId || "").trim()
  const sessionId = String(input.sessionId || "").trim()
  if (!merchantId) throw new Error("Missing merchant ID")
  if (!sessionId) throw new Error("Missing off-ramp session ID")

  const existing = await getOffRampSessionForMerchant(merchantId, sessionId)
  if (!existing) {
    throw new Error("Off-ramp session not found")
  }

  const provider = normalizeProvider(existing.provider)
  const network = normalizeNetwork(existing.network)
  const asset = normalizeAsset(existing.asset)
  const status = existing.status as OffRampSessionStatus
  const amount = Number(existing.crypto_amount)

  if (provider !== "moonpay") {
    throw new Error("Unsupported off-ramp provider for deposit instruction preview.")
  }

  if (!validateDepositPreviewStatus(status)) {
    throw new Error("Off-ramp session is not ready for deposit instruction preview.")
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid off-ramp amount")
  }

  const support = validateOffRampAssetSupport({
    provider,
    network,
    asset,
    merchantState: existing.metadata.merchantState as string | null | undefined
  })
  if (!support.supported) {
    throw new Error(support.reason || "Unsupported off-ramp request")
  }

  const adapter = getProviderAdapter(provider)
  const storedInstruction = getStoredDepositInstruction(existing)
  const instruction = storedInstruction || await adapter.getDepositInstructions({
    sessionId,
    merchantId,
    providerSessionId: existing.provider_session_id,
    externalTransactionId: existing.external_transaction_id,
    network,
    asset,
    amount
  })
  const approvalReady = Boolean(instruction.instructionReady && instruction.depositAddress)
  const message = getDepositPreviewMessage(status, instruction)

  await updateOffRampSessionStatus({
    merchantId,
    sessionId,
    status,
    providerStatus: existing.provider_status,
    metadata: {
      ...existing.metadata,
      depositInstructionPreviewedAt: new Date().toISOString(),
      depositInstructionReady: instruction.instructionReady,
      approvalReady,
      fundMovementEnabled: false
    }
  })

  if (recordPreviewEvent) {
    await recordOffRampEvent({
      sessionId,
      merchantId,
      eventType: "off_ramp.deposit_instruction.previewed",
      provider,
      providerStatus: existing.provider_status,
      rawPayload: {
        provider,
        network,
        asset,
        amount,
        instructionReady: instruction.instructionReady,
        depositAddressPresent: Boolean(instruction.depositAddress),
        memoPresent: Boolean(instruction.memo),
        destinationTagPresent: Boolean(instruction.destinationTag),
        approvalReady,
        message,
        providerCallsEnabled: false,
        fundMovementEnabled: false
      }
    })
  }

  return {
    session: toSummary(existing),
    provider,
    instructionReady: instruction.instructionReady,
    network,
    asset,
    amount,
    depositAddress: instruction.depositAddress,
    memo: instruction.memo,
    destinationTag: instruction.destinationTag,
    expiresAt: instruction.expiresAt,
    rawStatus: instruction.rawStatus,
    approvalReady,
    message,
    fundMovementEnabled: false,
    nextStep: "WAIT_FOR_MOONPAY_DEPOSIT_INSTRUCTIONS"
  }
}

export async function prepareOffRampWalletApprovalPreviewForMerchant(
  input: OffRampSessionScopedRequest
): Promise<OffRampWalletApprovalPreview> {
  const preview = await getOffRampDepositInstructionPreviewForMerchant(input, false)
  const approvalReady = Boolean(preview.depositAddress)
  const message = approvalReady
    ? "Wallet approval preview is ready. PineTree will still require explicit merchant approval before any future transfer."
    : "Wallet approval will be enabled after MoonPay provides deposit instructions."

  await recordOffRampEvent({
    sessionId: input.sessionId,
    merchantId: input.merchantId,
    eventType: "off_ramp.wallet_approval.previewed",
    provider: preview.provider,
    rawPayload: {
      provider: preview.provider,
      network: preview.network,
      asset: preview.asset,
      amount: preview.amount,
      instructionReady: preview.instructionReady,
      approvalReady,
      depositAddressPresent: Boolean(preview.depositAddress),
      signablePayloadCreated: false,
      providerCallsEnabled: false,
      fundMovementEnabled: false
    }
  })

  return {
    session: preview.session,
    approvalReady,
    fromWalletAddress: preview.session.sourceWalletAddress,
    destinationAddress: preview.depositAddress,
    asset: preview.asset,
    amount: preview.amount,
    network: preview.network,
    estimatedNetworkFee: null,
    message,
    instructionReady: preview.instructionReady,
    fundMovementEnabled: false,
    signablePayload: null,
    nextStep: approvalReady
      ? "MERCHANT_APPROVES_WALLET_TRANSFER"
      : "WAIT_FOR_MOONPAY_DEPOSIT_INSTRUCTIONS"
  }
}

async function findSessionForProviderWebhook(event: OffRampProviderWebhookEvent) {
  if (event.externalTransactionId) {
    const byExternalTransactionId = await getOffRampSessionByExternalTransactionId(
      event.provider,
      event.externalTransactionId
    )
    if (byExternalTransactionId) return byExternalTransactionId
  }

  if (event.providerSessionId) {
    const byProviderSessionId = await getOffRampSessionByProviderSessionId(
      event.provider,
      event.providerSessionId
    )
    if (byProviderSessionId) return byProviderSessionId
  }

  return null
}

export async function processOffRampProviderWebhook(
  input: ProcessOffRampProviderWebhookInput
): Promise<ProcessOffRampProviderWebhookResult> {
  const provider = normalizeProvider(input.provider)
  if (provider !== "moonpay") {
    throw new Error("Unsupported off-ramp webhook provider.")
  }

  const adapter = getProviderAdapter(provider)
  const verified = await adapter.verifyWebhookSignature({
    payload: input.rawBody,
    signature: input.signature
  })

  if (!verified) {
    throw new Error("Invalid MoonPay webhook signature.")
  }

  const event = await adapter.normalizeTransactionStatus(input.rawBody)
  const session = await findSessionForProviderWebhook(event)
  if (!session) {
    return {
      processed: true,
      matchedSession: false,
      providerStatus: event.providerStatus || null,
      fundMovementEnabled: false
    }
  }

  const statusUpdate = getWebhookStatusUpdate(event)
  const depositInstructionReady = Boolean(event.depositAddress)
  const metadata: Record<string, unknown> = {
    ...session.metadata,
    lastWebhookAt: new Date().toISOString(),
    lastProviderEventType: event.eventType,
    providerCallsEnabled: true,
    fundMovementEnabled: false
  }

  if (event.externalTransactionId && event.externalTransactionId !== session.id) {
    metadata.externalTransactionId = event.externalTransactionId
  }
  if (depositInstructionReady) {
    metadata.depositInstructionReady = true
    metadata.depositAddress = event.depositAddress
    metadata.depositMemo = event.memo || null
    metadata.depositDestinationTag = event.destinationTag || null
    metadata.depositInstructionSource = "moonpay_webhook"
  }
  if (event.cryptoTxHash) {
    metadata.providerCryptoTxHashSeen = true
  }
  if (event.payoutStatus) {
    metadata.providerPayoutStatus = event.payoutStatus
  }

  const updated = await updateOffRampSessionFromProviderStatus({
    provider,
    sessionId: session.id,
    status: statusUpdate || session.status,
    providerStatus: event.providerStatus || session.provider_status,
    providerSessionId: event.providerSessionId || undefined,
    externalTransactionId:
      event.externalTransactionId && event.externalTransactionId !== session.id
        ? event.externalTransactionId
        : undefined,
    errorCode: providerStatusIndicatesFailure(event.providerStatus) ? "OFF_RAMP_PROVIDER_FAILED" : null,
    errorMessage: providerStatusIndicatesFailure(event.providerStatus)
      ? "MoonPay reported the off-ramp transaction failed."
      : null,
    metadata
  })

  await recordOffRampEvent({
    sessionId: session.id,
    merchantId: session.merchant_id,
    eventType: "off_ramp.moonpay.webhook.received",
    provider,
    providerEventId: event.providerEventId || null,
    providerStatus: event.providerStatus || null,
    rawPayload: {
      eventType: event.eventType,
      providerSessionId: event.providerSessionId || null,
      externalTransactionIdPresent: Boolean(event.externalTransactionId),
      providerStatus: event.providerStatus || null,
      depositAddressPresent: Boolean(event.depositAddress),
      cryptoTxHashPresent: Boolean(event.cryptoTxHash),
      payoutStatus: event.payoutStatus || null,
      rawPayloadSafe: event.rawPayloadSafe,
      providerCallsEnabled: true,
      fundMovementEnabled: false
    }
  })

  await recordOffRampEvent({
    sessionId: session.id,
    merchantId: session.merchant_id,
    eventType: "off_ramp.moonpay.status.updated",
    provider,
    providerEventId: event.providerEventId || null,
    providerStatus: event.providerStatus || null,
    rawPayload: {
      previousStatus: session.status,
      status: updated.status,
      providerStatus: event.providerStatus || null,
      completedStatusSuppressed: providerStatusIndicatesCompleted(event.providerStatus),
      cryptoTxHashColumnUpdated: false,
      fiatSettledAtUpdated: false,
      providerCallsEnabled: true,
      fundMovementEnabled: false
    }
  })

  if (depositInstructionReady) {
    await recordOffRampEvent({
      sessionId: session.id,
      merchantId: session.merchant_id,
      eventType: "off_ramp.deposit_instruction.ready",
      provider,
      providerEventId: event.providerEventId || null,
      providerStatus: event.providerStatus || null,
      rawPayload: {
        depositAddressPresent: true,
        memoPresent: Boolean(event.memo),
        destinationTagPresent: Boolean(event.destinationTag),
        signablePayloadCreated: false,
        providerCallsEnabled: true,
        fundMovementEnabled: false
      }
    })
  }

  return {
    processed: true,
    matchedSession: true,
    sessionId: session.id,
    statusUpdate: updated.status,
    providerStatus: event.providerStatus || null,
    fundMovementEnabled: false
  }
}

export async function listOffRampSessionsForMerchant(
  merchantId: string
): Promise<OffRampSessionSummary[]> {
  const normalizedMerchantId = String(merchantId || "").trim()
  if (!normalizedMerchantId) {
    throw new Error("Missing merchant ID")
  }

  const sessions = await listOffRampSessionRowsForMerchant(normalizedMerchantId)
  return sessions.map(toSummary)
}
