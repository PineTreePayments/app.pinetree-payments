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
  capabilities: ProviderCapabilities
}

export type CreateLightningInvoiceInput = LightningInvoiceRequest
export type CreateLightningInvoiceResult = LightningInvoice

export type LightningProviderEvent = {
  providerReference?: string
  paymentId?: string
  paymentHash?: string
  status?: LightningInvoiceStatus | string
  raw: unknown
}
