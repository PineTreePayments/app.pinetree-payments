import { ProviderAdapter } from "@/types/provider"
import { registerProvider, setProviderHealth } from "../registry"
import { createPayment as createStripePayment } from "./payments"
import {
  STRIPE_DISPLAY_NAME,
  STRIPE_PROVIDER_ID
} from "./constants"
import { getPaymentStatus as getStripePaymentStatus } from "./paymentStatus"
import { translateEvent as translateStripeEvent } from "./translateEvent"
import { verifyWebhook as verifyStripeWebhook } from "./verifyWebhook"

export const stripeAdapter: ProviderAdapter = {
  metadata: {
    adapterId: STRIPE_PROVIDER_ID,
    displayName: STRIPE_DISPLAY_NAME,
    supportedNetworks: ["stripe"],
    feeCaptureMethods: ["collection_then_settle"],
    capabilities: {
      hostedCheckout: false,
      walletRails: false,
      webhooks: true
    }
  },

  async getMerchantWallet(merchantId: string) {
    return {
      address: `stripe_${merchantId}`,
      network: "stripe"
    }
  },

  async createPayment(input) {
    try {
      const payment = await createStripePayment(input)
      setProviderHealth("stripe", true)
      return {
        providerReference: payment.providerReference,
        feeCaptureMethod: payment.feeCaptureMethod,
        clientSecret: payment.clientSecret,
        raw: payment.raw
      }
    } catch (error) {
      console.error("Stripe adapter payment error:", error)
      setProviderHealth("stripe", false)
      throw error
    }
  },

  async getPaymentStatus(providerReference: string) {
    try {
      const payment = await getStripePaymentStatus(providerReference)
      return { status: payment.status }
    } catch (error) {
      console.error("Stripe adapter status check error:", error)
      return { status: "UNKNOWN" as const }
    }
  },

  verifyWebhook(_payload: unknown, signature?: string, rawBody?: string, headers?: Record<string, string>) {
    return verifyStripeWebhook({ signature, rawBody, headers })
  },

  translateEvent(payload: unknown) {
    return translateStripeEvent(payload)
  }
}

registerProvider("stripe", stripeAdapter)
