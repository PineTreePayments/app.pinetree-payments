/**
 * Base Provider Adapter Abstract Class
 * 
 * All payment adapters MUST extend this base class.
 * Implements the standard ProviderAdapter interface with default implementations.
 * Follows PineTree architecture rules strictly.
 */

import type {
  ProviderAdapter,
  PaymentStatus,
  FeeCaptureMethod,
  ProviderAdapterMetadata
} from "@/types/provider"
import type { PaymentNetwork } from "@/types/payment"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

export abstract class BaseProviderAdapter implements ProviderAdapter {
  /**
   * Provider identifier (lowercase, no spaces)
   */
  abstract readonly providerId: string

  /**
   * Human readable provider name
   */
  abstract readonly providerName: string

  /**
   * Supported networks for this provider
   */
  abstract readonly supportedNetworks: string[]

  get metadata(): ProviderAdapterMetadata {
    return {
      adapterId: this.providerId,
      displayName: this.providerName,
      supportedNetworks: this.supportedNetworks as PaymentNetwork[]
    }
  }

  /**
   * Create payment on provider network
   * Override this method in concrete adapter implementations
   */
  async createPayment(input: {
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
  }> {
    void input
    throw new Error(`createPayment not implemented for ${this.providerName}`)
  }

  /**
   * Get merchant wallet address for direct rail payments
   */
  async getMerchantWallet(merchantId: string): Promise<{
    address: string
    network: string
  }> {
    void merchantId
    throw new Error(`getMerchantWallet not implemented for ${this.providerName}`)
  }

  /**
   * Get payment status from provider
   */
  async getPaymentStatus(providerReference: string): Promise<{
    status: PaymentStatus
  }> {
    void providerReference
    return { status: "PROCESSING" }
  }

  /**
   * Verify webhook signature authenticity
   */
  verifyWebhook(payload: unknown, signature?: string, rawBody?: string): boolean {
    void payload
    void signature
    void rawBody
    return true
  }

  /**
   * Translate provider event to standard PineTree event
   */
  translateEvent(payload: unknown): {
    paymentId: string
    event:
      | "payment.created"
      | "payment.pending"
      | "payment.processing"
      | "payment.confirmed"
      | "payment.failed"
  } {
    const source = isRecord(payload) ? payload : {}
    const paymentId = String(source.paymentId || source.reference || "")

    return {
      paymentId,
      event: "payment.pending"
    }
  }

  /**
   * Provider health check
   */
  async healthCheck(): Promise<boolean> {
    return true
  }
}