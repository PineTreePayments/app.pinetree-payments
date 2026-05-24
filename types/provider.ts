import type { PaymentAdapterId, PaymentNetwork } from "./payment"

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "INCOMPLETE"
  | "EXPIRED"
  | "REFUNDED"

export type FeeCaptureMethod =
  | "atomic_split"
  | "contract_split"
  | "direct"
  | "invoice_split"
  | "collection_then_settle"
  | "post_payment_nwc"

export type ProviderCustodyModel =
  | "provider"
  | "merchant"
  | "noncustodial"
  | "self_custody"
  | "unknown"

export type ProviderCapabilities = {
  hostedCheckout?: boolean
  walletRails?: boolean
  webhooks?: boolean
  supportsLightningInvoice?: boolean
  supportsFeeAtPaymentTime?: boolean
  supportsSplitSettlement?: boolean
  supportsWebhookConfirmation?: boolean
  requiresKyc?: boolean | "unknown"
  custodyModel?: ProviderCustodyModel
}

export type LightningInvoiceRequest = {
  paymentId: string
  merchantId: string
  merchantAmount: number
  pinetreeFee: number
  grossAmount: number
  currency: string
  merchantWallet?: string
  pinetreeWallet?: string
  providerApiKey?: string
  metadata?: Record<string, unknown>
  nwcUri?: string
  btcPriceUsd?: number
}

export type LightningInvoice = {
  providerReference: string
  invoice: string
  paymentHash?: string
  paymentUrl?: string
  qrCodeUrl?: string
  expiresAt?: string
  feeCaptureMethod: "invoice_split" | "collection_then_settle" | "post_payment_nwc"
  metadata?: Record<string, unknown>
}

export type LightningInvoiceStatus =
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"

export type StandardPaymentEvent = {
  paymentId: string
  event:
    | "payment.created"
    | "payment.pending"
    | "payment.processing"
    | "payment.confirmed"
    | "payment.failed"
}

export interface ProviderAdapterMetadata {
  adapterId: PaymentAdapterId | string
  displayName: string
  supportedNetworks: readonly PaymentNetwork[]
  credentialKey?: string
  feeCaptureMethods?: FeeCaptureMethod[]
  capabilities?: ProviderCapabilities
}

export interface ProviderAdapter {
  metadata?: ProviderAdapterMetadata

  /* --------------------------------
  PROVIDER GENERATED PAYMENT
  (legacy / fallback)
  -------------------------------- */

  createPayment?(input: {
    paymentId: string
    merchantAmount: number
    pinetreeFee: number
    grossAmount: number
    currency: string
    merchantWallet: string
    pinetreeWallet: string
    merchantId?: string
    network?: string
    providerApiKey?: string
  }): Promise<{
    providerReference: string
    paymentUrl?: string
    qrCodeUrl?: string
    feeCaptureMethod?: FeeCaptureMethod
  }>

  /* --------------------------------
  WALLET RAIL SUPPORT
  (PineTree generated payments)
  -------------------------------- */

  getMerchantWallet?(merchantId: string): Promise<{
    address: string
    network: string
  }>

  /* --------------------------------
  PAYMENT STATUS
  -------------------------------- */

  getPaymentStatus?(providerReference: string): Promise<{
    status: PaymentStatus
  }>

  /* --------------------------------
  LIGHTNING INVOICE SUPPORT
  -------------------------------- */

  createLightningInvoice?(input: LightningInvoiceRequest): Promise<LightningInvoice>

  getLightningInvoiceStatus?(providerReference: string): Promise<{
    status: LightningInvoiceStatus
  }>

  /* --------------------------------
  WEBHOOK SUPPORT
  -------------------------------- */

  verifyWebhook?(
    payload: unknown,
    signature?: string,
    rawBody?: string,
    headers?: Record<string, string>
  ): boolean

  translateEvent?(payload: unknown): StandardPaymentEvent

  /**
   * Health check implementation
   * Returns true if provider is healthy and available
   */
  healthCheck?(): Promise<boolean>

}
