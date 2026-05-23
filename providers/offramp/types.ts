import type {
  OffRampAsset,
  OffRampNetwork,
  OffRampProvider
} from "@/engine/offRampOperations"

export type OffRampProviderErrorCode =
  | "OFF_RAMP_PROVIDER_DISABLED"
  | "OFF_RAMP_PROVIDER_NOT_IMPLEMENTED"
  | "OFF_RAMP_PROVIDER_REQUEST_FAILED"
  | "OFF_RAMP_PROVIDER_UNSUPPORTED"

export class OffRampProviderError extends Error {
  code: OffRampProviderErrorCode
  status: number

  constructor(message: string, code: OffRampProviderErrorCode, status = 400) {
    super(message)
    this.name = "OffRampProviderError"
    this.code = code
    this.status = status
  }
}

export type OffRampProviderQuoteInput = {
  provider: OffRampProvider
  network: OffRampNetwork
  asset: OffRampAsset
  amount: number
  fiatCurrency?: string
  payoutMethod?: string | null
  extraFeePercentage?: number | null
}

export type OffRampProviderQuote = {
  provider: OffRampProvider
  moonPayCode: string
  asset: OffRampAsset
  network: OffRampNetwork
  cryptoAmount: number
  fiatCurrency: string
  quoteFiatAmount: number | null
  providerFeeAmount: number | null
  platformFeeAmount: number | null
  totalFeeAmount: number | null
  payoutMethod: string | null
  quoteExpiresAt: string | null
  rawProviderResponse?: Record<string, unknown>
}

export type OffRampProviderSessionInput = {
  sessionId: string
  merchantId: string
  quote: OffRampProviderQuote
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  redirectUrl?: string | null
}

export type OffRampProviderSessionPreparation = {
  provider: OffRampProvider
  implemented: boolean
  status: "NOT_IMPLEMENTED" | "PREPARED"
  message: string
  providerSessionId?: string | null
  externalTransactionId?: string | null
  redirectUrl?: string | null
  rawProviderResponse?: Record<string, unknown>
}

export type OffRampProviderWidgetUrlInput = {
  sessionId: string
  merchantId: string
  network: OffRampNetwork
  asset: OffRampAsset
  moonPayCode: string
  cryptoAmount: number
  fiatCurrency?: string
  payoutMethod?: string | null
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  merchantEmail?: string | null
  redirectUrl: string
}

export type OffRampProviderWidgetUrl = {
  provider: OffRampProvider
  widgetUrl: string
  signed: boolean
  expiresAt?: string | null
  fundMovementEnabled: false
}

export type OffRampDepositInstructionInput = {
  sessionId: string
  merchantId: string
  providerSessionId?: string | null
  externalTransactionId?: string | null
  network: OffRampNetwork
  asset: OffRampAsset
  amount: number
}

export type OffRampDepositInstruction = {
  provider: OffRampProvider
  providerSessionId?: string | null
  externalTransactionId?: string | null
  network: OffRampNetwork
  asset: OffRampAsset
  amount: number
  depositAddress: string | null
  memo: string | null
  destinationTag: string | null
  expiresAt: string | null
  rawStatus: string | null
  instructionReady: boolean
  message: string
  fundMovementEnabled: false
}

export type OffRampSessionStatusInput = {
  providerSessionId?: string | null
  externalTransactionId?: string | null
}

export type OffRampWebhookVerifyInput = {
  payload: string
  signature?: string | null
}

export type OffRampWebhookEvent = {
  provider: OffRampProvider
  providerEventId?: string | null
  providerStatus?: string | null
  eventType: string
  rawPayload: Record<string, unknown>
}

export type OffRampProviderAdapter = {
  provider: OffRampProvider
  getQuote(input: OffRampProviderQuoteInput): Promise<OffRampProviderQuote>
  createSession(input: OffRampProviderSessionInput): Promise<OffRampProviderSessionPreparation>
  createWidgetUrl(input: OffRampProviderWidgetUrlInput): Promise<OffRampProviderWidgetUrl>
  getDepositInstructions(input: OffRampDepositInstructionInput): Promise<OffRampDepositInstruction>
  getSessionStatus(input: OffRampSessionStatusInput): Promise<OffRampProviderSessionPreparation>
  verifyWebhook(input: OffRampWebhookVerifyInput): Promise<boolean>
  parseWebhookEvent(input: unknown): Promise<OffRampWebhookEvent>
  supportsAsset(input: { network: OffRampNetwork; asset: OffRampAsset }): boolean
  supportsRegion(input: { network: OffRampNetwork; merchantState?: string | null }): {
    supported: boolean
    reason?: string
  }
}
