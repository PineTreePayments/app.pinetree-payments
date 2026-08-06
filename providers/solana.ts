/**
 * Solana Pay Adapter
 * 
 * Implements the provider adapter interface for Solana Pay integration.
 * Handles payment URI generation, QR code creation, and transaction monitoring.
 */

import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "./registry"

/**
 * Solana Pay URI parameters
 */
interface SolanaPayParams {
  recipient: string
  amount?: number
  label?: string
  message?: string
  memo?: string
  reference?: string
  splitter?: Record<string, number>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

export const solanaAdapter: ProviderAdapter = {
  metadata: {
    adapterId: "solana",
    displayName: "Solana Pay",
    supportedNetworks: ["solana"],
    feeCaptureMethods: ["atomic_split"],
    capabilities: {
      hostedCheckout: false,
      walletRails: true,
      webhooks: false
    }
  },

  /* --------------------------------
     WALLET RAIL SUPPORT
     Returns merchant's Solana wallet address
  -------------------------------- */

  async getMerchantWallet(merchantId: string) {
    void merchantId

    return {
      address: "engine-managed-wallet",
      network: "solana"
    }
  },

  /* --------------------------------
     CREATE PAYMENT
     Generates a Solana Pay URI for payment
  -------------------------------- */

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
    // The engine's generateSplitPayment builds the canonical Solana Pay Transaction
    // Request URL (/api/solana-pay/transaction?paymentId=...) which includes both
    // the merchant and PineTree split transfers + memo instruction.
    // We must NOT return a paymentUrl here — if we did, it would override that URL
    // with a simple single-recipient URI that doesn't enforce the fee split.
    return {
      providerReference: input.paymentId,
      feeCaptureMethod: "atomic_split"
      // paymentUrl intentionally omitted — engine uses Transaction Request URL
    }
  },

  /* --------------------------------
     GET PAYMENT STATUS
     For Solana, we rely on blockchain monitoring
     Provider polling is unsupported; the watcher owns chain status.
  -------------------------------- */

  async getPaymentStatus(providerReference: string) {
    const paymentId = String(providerReference || "").trim()
    if (!paymentId) throw new Error("Solana payment reference is required")
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

  /* --------------------------------
     VERIFY WEBHOOK
     Solana has no adapter-level webhook contract — reject.
  -------------------------------- */

  verifyWebhook(payload: unknown, signature?: string, rawBody?: string): boolean {
    void payload
    void signature
    void rawBody
    // Solana confirmation comes from chain evidence, never from an adapter
    // webhook. The real intake is POST /api/webhooks/solana, which verifies the
    // Alchemy HMAC against the raw request body and then calls
    // processAlchemyWebhook — it never reaches this method.
    //
    // This previously returned `true`, which let a forged payload
    // ({"reference": "<paymentId>", "confirmed": true}) confirm a payment
    // through the generic webhook route. Reject explicitly instead.
    throw new Error(
      "Solana has no adapter webhook contract; use POST /api/webhooks/solana (Alchemy HMAC over the raw body)"
    )
  },

  /* --------------------------------
     TRANSLATE EVENT
     Converts Solana payment events to PineTree events
  -------------------------------- */

  translateEvent(payload: unknown) {
    const source = isRecord(payload) ? payload : {}
    const reference = String(source.reference || source.paymentId || "")
    const confirmed = Boolean(source.confirmed)
    const detected = Boolean(source.detected)

    if (confirmed) {
      return {
        paymentId: reference,
        event: "payment.confirmed" as const
      }
    }

    if (detected) {
      return {
        paymentId: reference,
        event: "payment.processing" as const
      }
    }

    console.warn("[solana] unknown payment event", { paymentId: reference || null })
    return null
  }
}

/**
 * Build a Solana Pay URI
 * 
 * @param params - Payment parameters
 * @returns Solana Pay URI string
 */
export function buildSolanaPayUri(params: SolanaPayParams): string {
  const baseUrl = `solana:${params.recipient}`
  const queryParams: string[] = []

  if (params.amount !== undefined) {
    queryParams.push(`amount=${params.amount}`)
  }

  if (params.label) {
    queryParams.push(`label=${encodeURIComponent(params.label)}`)
  }

  if (params.message) {
    queryParams.push(`message=${encodeURIComponent(params.message)}`)
  }

  if (params.memo) {
    queryParams.push(`memo=${encodeURIComponent(params.memo)}`)
  }

  if (params.reference) {
    queryParams.push(`reference=${params.reference}`)
  }

  if (queryParams.length > 0) {
    return `${baseUrl}?${queryParams.join("&")}`
  }

  return baseUrl
}

// Register the adapter
registerProvider("solana", solanaAdapter)
