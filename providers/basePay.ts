import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"
import { getBestWalletForNetwork } from "@/database/merchantWallets"

/**
 * Base Pay adapter
 *
 * Used for wallet-rail Base payments routed by engine/createPayment.
 * The engine handles split generation + DB writes; adapter provides
 * network registration + wallet capability for provider validation.
 */
export const basePayAdapter: ProviderAdapter = {
  async getMerchantWallet(merchantId: string) {
    const wallet = await getBestWalletForNetwork(merchantId, "base")

    if (!wallet?.wallet_address) {
      throw new Error("Merchant Base wallet not configured")
    }

    return {
      address: wallet.wallet_address,
      network: "base"
    }
  },

  async createPayment(input: {
    paymentId: string
    amount: number
    currency: string
    merchantId: string
  }) {
    // Engine wallet-rail flow generates final URI/QR.
    // Return minimal reference for adapter interface compatibility.
    return {
      providerReference: input.paymentId
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
