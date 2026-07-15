import { ProviderAdapter } from "@/types/provider"
import { registerProvider, setProviderHealth } from "../registry"
import { createPayment as createFluidPayPayment } from "./payments"
import {
  FLUIDPAY_DISPLAY_NAME,
  FLUIDPAY_PROVIDER_ID
} from "./constants"
import { getPaymentStatus as getFluidPayPaymentStatus } from "./paymentStatus"
import { translateEvent as translateFluidPayEvent } from "./translateEvent"
import { verifyWebhook as verifyFluidPayWebhook } from "./verifyWebhook"

export const fluidPayAdapter: ProviderAdapter = {
  metadata: {
    adapterId: FLUIDPAY_PROVIDER_ID,
    displayName: FLUIDPAY_DISPLAY_NAME,
    supportedNetworks: ["fluidpay"],
    feeCaptureMethods: ["collection_then_settle"],
    capabilities: {
      hostedCheckout: false,
      walletRails: false,
      webhooks: false
    }
  },

  async getMerchantWallet(merchantId: string) {
    return {
      address: `fluidpay_${merchantId}`,
      network: "fluidpay"
    }
  },

  async createPayment(input) {
    setProviderHealth("fluidpay", false)
    return createFluidPayPayment(input)
  },

  async getPaymentStatus(providerReference: string) {
    setProviderHealth("fluidpay", false)
    return getFluidPayPaymentStatus(providerReference)
  },

  verifyWebhook() {
    return verifyFluidPayWebhook()
  },

  translateEvent(payload: unknown) {
    return translateFluidPayEvent(payload)
  }
}

registerProvider("fluidpay", fluidPayAdapter)
