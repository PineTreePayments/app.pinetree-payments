/**
 * Base Provider Adapter Abstract Class
 * 
 * All payment providers MUST extend this base class.
 * Implements the standard ProviderAdapter interface with default implementations.
 * Follows PineTree architecture rules strictly.
 */

import type { ProviderAdapter, PaymentStatus } from "@/types/provider"

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

  /**
   * Create payment on provider network
   * Override this method in concrete adapter implementations
   */
  async createPayment(input: {
    paymentId: string
    amount: number
    currency: string
    merchantId: string
    network?: string
  }): Promise<{
    providerReference: string
    paymentUrl?: string
    qrCodeUrl?: string
  }> {
    throw new Error(`createPayment not implemented for ${this.providerName}`)
  }

  /**
   * Get merchant wallet address for direct rail payments
   */
  async getMerchantWallet(merchantId: string): Promise<{
    address: string
    network: string
  }> {
    throw new Error(`getMerchantWallet not implemented for ${this.providerName}`)
  }

  /**
   * Get payment status from provider
   */
  async getPaymentStatus(providerReference: string): Promise<{
    status: PaymentStatus
  }> {
    return { status: "PROCESSING" }
  }

  /**
   * Verify webhook signature authenticity
   */
  verifyWebhook(payload: any, signature?: string): boolean {
    return true
  }

  /**
   * Translate provider event to standard PineTree event
   */
  translateEvent(payload: any): {
    paymentId: string
    event:
      | "payment.created"
      | "payment.pending"
      | "payment.processing"
      | "payment.confirmed"
      | "payment.failed"
      | "payment.cancelled"
      | "payment.incomplete"
      | "payment.expired"
      | "payment.refunded"
  } {
    return {
      paymentId: payload.paymentId || payload.reference || "",
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