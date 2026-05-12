import type {
  LightningInvoice,
  LightningInvoiceRequest,
  LightningInvoiceStatus,
  ProviderCapabilities
} from "@/types/provider"

export const LIGHTNING_NETWORK = "bitcoin_lightning" as const
export const LIGHTNING_ASSET = "BTC" as const

export type LightningProviderConfig = {
  providerKey: string
  displayName: string
  apiBaseUrl?: string
  webhookSecret?: string
  environment?: string
  platformAccountId?: string
  speedAccountTransfersSupported: boolean
  capabilities: ProviderCapabilities
}

export type CreateLightningInvoiceInput = LightningInvoiceRequest
export type CreateLightningInvoiceResult = LightningInvoice

export type SpeedCreatePaymentMetadata = {
  pineTreePaymentId: string
  merchantId: string
  merchantAmount: number
  pineTreeFee: number
  grossAmount: number
  speedAccountId: string
  settlementAccountId?: string
  settlementAccountSource?: "db_credentials" | "platform_account_fallback"
  merchantLightningAddress: string
  paymentAddressId?: string
  settlementMode: "speed_merchant_account" | "speed_platform_account_fallback"
  feeCaptureMethod: "invoice_split"
  provider: "speed"
  network: "bitcoin_lightning"
}

export type SpeedCreatePaymentRequest = {
  currency: string
  amount: number
  target_currency: "SATS"
  payment_methods: ["lightning"]
  description: string
  metadata: SpeedCreatePaymentMetadata
  transfers?: Array<Record<string, unknown>>
}

export type LightningProviderEvent = {
  providerReference?: string
  paymentId?: string
  paymentHash?: string
  status?: LightningInvoiceStatus | string
  raw: unknown
}
