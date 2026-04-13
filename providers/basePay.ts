import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"

/**
 * Base Pay adapter
 *
 * Used for wallet-rail Base payments routed by engine/createPayment.
 * The engine handles split generation + DB writes; adapter provides
 * network registration + wallet capability for provider validation.
 */
export const basePayAdapter: ProviderAdapter = {
  metadata: {
    adapterId: "base",
    displayName: "Base Pay",
    supportedNetworks: ["base"],
    feeCaptureMethods: ["contract_split"],
    capabilities: {
      hostedCheckout: false,
      walletRails: true,
      webhooks: false
    }
  },
  async getMerchantWallet(merchantId: string) {
    void merchantId

    return {
      address: "engine-managed-wallet",
      network: "base"
    }
  },

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
  }) {
    // Engine wallet-rail flow generates final URI/QR.
    // Return minimal reference for adapter interface compatibility.
    return {
      providerReference: input.paymentId,
      feeCaptureMethod: "contract_split"
    }
  },

  async getPaymentStatus() {
    return {
      status: "PROCESSING" as const
    }
  },

  verifyWebhook() {
    return true
  },

  translateEvent(payload: { paymentId?: string; reference?: string }) {
    return {
      paymentId: payload?.paymentId || payload?.reference || "",
      event: "payment.pending" as const
    }
  }
}

registerProvider("base", basePayAdapter)
