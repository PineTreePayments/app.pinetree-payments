import { ProviderAdapter } from "@/types/provider"
import { registerProvider, setProviderHealth } from "../registry"
import { createPayment as createShift4Payment } from "./payments"
import {
  SHIFT4_DISPLAY_NAME,
  SHIFT4_PROVIDER_ID
} from "./constants"
import { getPaymentStatus as getShift4PaymentStatus } from "./paymentStatus"
import { Shift4Client } from "./client"
import { translateEvent as translateShift4Event } from "./translateEvent"
import { verifyWebhook as verifyShift4Webhook } from "./verifyWebhook"

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
      console.error("Shift4 adapter payment error", {
        errorName: error instanceof Error ? error.name : "unknown",
        status: typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : null,
      })
      setProviderHealth("shift4", false)
      throw error
    }
  },

  async getPaymentStatus(providerReference: string, merchantId?: string) {
    try {
      if (!merchantId) throw new Error("Merchant ID is required for Shift4 payment retrieval")
      const { getMerchantCredential } = await import("@/database")
      const merchantApiKey = await getMerchantCredential(merchantId, "shift4_api_key")
      if (!merchantApiKey) throw new Error("Shift4 merchant API key not configured")
      const payment = await getShift4PaymentStatus(providerReference, {
        client: new Shift4Client({ secretKey: merchantApiKey }),
      })
      return { status: payment.status }
    } catch (error) {
      console.error("Shift4 adapter status check error", {
        errorName: error instanceof Error ? error.name : "unknown",
        status: typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : null,
      })
      throw error
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
