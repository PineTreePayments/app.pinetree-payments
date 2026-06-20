import { ProviderAdapter } from "@/types/provider"
import { registerProvider, setProviderHealth } from "../engine/providerRegistry"
import {
  createPayment as createFluidPayPayment,
  FLUIDPAY_DISPLAY_NAME,
  FLUIDPAY_PROVIDER_ID,
  getPaymentStatus as getFluidPayPaymentStatus,
  translateEvent as translateFluidPayEvent,
  verifyWebhook as verifyFluidPayWebhook
} from "@/lib/providers/fluidpay"

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
