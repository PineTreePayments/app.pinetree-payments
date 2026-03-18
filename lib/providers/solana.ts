import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"

export const solanaAdapter: ProviderAdapter = {

  async createPayment(input) {

    const uri =
      `solana:${process.env.SOLANA_WALLET}?amount=${input.amount}&reference=${input.paymentId}`

    return {
      providerReference: input.paymentId,
      qrCode: uri
    }

  },

  async getPaymentStatus() {

    return {
      status: "PROCESSING"
    }

  },

  verifyWebhook() {
    return true
  },

  translateEvent(payload) {

    if (payload.confirmed) {
      return {
        paymentId: payload.reference,
        event: "payment.confirmed"
      }
    }

    return {
      paymentId: payload.reference,
      event: "payment.processing"
    }

  }

}

registerProvider("solana", solanaAdapter)