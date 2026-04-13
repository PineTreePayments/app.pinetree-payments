export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "INCOMPLETE"
  | "EXPIRED"
  | "REFUNDED"

export interface ProviderAdapter {

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
  }): Promise<{
    providerReference: string
    paymentUrl?: string
    qrCodeUrl?: string
    feeCaptureMethod?: string
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

  translateEvent?(payload: unknown): {
    paymentId: string
    event:
      | "payment.created"
      | "payment.pending"
      | "payment.processing"
      | "payment.confirmed"
      | "payment.failed"
  }

  /**
   * Health check implementation
   * Returns true if provider is healthy and available
   */
  healthCheck?(): Promise<boolean>

}
