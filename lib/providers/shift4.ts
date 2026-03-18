import { ProviderAdapter } from "../../types/provider"
import { registerProvider } from "../engine/providerRegistry"

export const shift4Adapter: ProviderAdapter = {

  async createPayment({ paymentId, amount, currency }) {

    return {
      providerReference: `shift4_${paymentId}`,
      paymentUrl: undefined,
      qrCode: undefined
    }

  },

  async getPaymentStatus(providerReference) {

    return {
      status: "PENDING"
    }

  },

  verifyWebhook(payload) {
    return true
  },

  translateEvent(payload) {
    return {
      paymentId: payload.paymentId,
      event: "payment.confirmed"
    }
  }

}

registerProvider("shift4", shift4Adapter)