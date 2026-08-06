import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "./registry"

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
    displayName: "Base / ETH Pay",
    supportedNetworks: ["base"],
    feeCaptureMethods: ["contract_split", "direct"],
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
    // feeCaptureMethod is determined by generateSplitPayment based on PINETREE_EVM_SPLIT_MODE.
    return {
      providerReference: input.paymentId
    }
  },

  async getPaymentStatus(providerReference: string) {
    const paymentId = String(providerReference || "").trim()
    if (!paymentId) throw new Error("Base payment reference is required")
    const [{ runPaymentWatcher }, { getPaymentById }] = await Promise.all([
      import("@/engine/checkPaymentOnce"),
      import("@/database"),
    ])
    await runPaymentWatcher(paymentId)
    const payment = await getPaymentById(paymentId)
    return {
      status: payment?.status
        ? String(payment.status).toUpperCase() as import("@/types/provider").PaymentStatus
        : null,
    }
  },

  verifyWebhook(): boolean {
    // Base confirmation comes from chain evidence, never from an adapter
    // webhook. The real intake is POST /api/webhooks/base, which verifies the
    // Alchemy HMAC against the raw request body and then calls
    // processAlchemyWebhook — it never reaches this method.
    //
    // This previously returned `true`, so the generic webhook route could
    // accept an unsigned Base payload. Reject explicitly instead.
    throw new Error(
      "Base has no adapter webhook contract; use POST /api/webhooks/base (Alchemy HMAC over the raw body)"
    )
  },

  translateEvent(payload: { paymentId?: string; reference?: string }) {
    console.warn("[base] unknown provider event", { paymentId: payload?.paymentId || payload?.reference || null })
    return null
  }
}

registerProvider("base", basePayAdapter)
