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
  capabilities?: {
    hostedCheckout?: boolean
    walletRails?: boolean
    webhooks?: boolean
  }
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
  WEBHOOK SUPPORT
  -------------------------------- */

  verifyWebhook?(payload: unknown, signature?: string, rawBody?: string): boolean

  translateEvent?(payload: unknown): StandardPaymentEvent

  /**
   * Health check implementation
   * Returns true if provider is healthy and available
   */
  healthCheck?(): Promise<boolean>

}
