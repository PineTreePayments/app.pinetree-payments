import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"
import { setProviderHealth } from "../engine/providerRegistry"
import {
  createPayment as createShift4Payment,
  getPaymentStatus as getShift4PaymentStatus,
  SHIFT4_DISPLAY_NAME,
  SHIFT4_PROVIDER_ID,
  translateEvent as translateShift4Event,
  verifyWebhook as verifyShift4Webhook
} from "@/lib/providers/shift4"

export const shift4Adapter: ProviderAdapter = {
  metadata: {
    adapterId: SHIFT4_PROVIDER_ID,
    displayName: SHIFT4_DISPLAY_NAME,
    supportedNetworks: ["shift4"],
    credentialKey: "shift4_api_key",
    feeCaptureMethods: ["invoice_split"],
    capabilities: {
      hostedCheckout: true,
      walletRails: false,
      webhooks: true
    }
  },

  async getMerchantWallet(merchantId: string) {
    return {
      address: `shift4_${merchantId}`,
      network: "shift4"
    }
  },

  async createPayment(input) {
    try {
      const payment = await createShift4Payment(input)
      setProviderHealth("shift4", true)
      return {
        providerReference: payment.providerReference,
        paymentUrl: payment.paymentUrl,
        qrCodeUrl: payment.qrCodeUrl,
        feeCaptureMethod: payment.feeCaptureMethod
      }
    } catch (error) {
      console.error("Shift4 adapter payment error:", error)
      setProviderHealth("shift4", false)
      throw error
    }
  },

  async getPaymentStatus(providerReference: string) {
    try {
      const payment = await getShift4PaymentStatus(providerReference)
      return { status: payment.status }
    } catch (error) {
      console.error("Shift4 adapter status check error:", error)
      return { status: "PENDING" as const }
    }
  },

  verifyWebhook(payload: unknown, signature?: string, rawBody?: string, headers?: Record<string, string>) {
    return verifyShift4Webhook({ payload, signature, rawBody, headers })
  },

  translateEvent(payload: unknown) {
    return translateShift4Event(payload)
  }
}

registerProvider("shift4", shift4Adapter)
