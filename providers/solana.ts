/**
 * Solana Pay Adapter
 * 
 * Implements the provider adapter interface for Solana Pay integration.
 * Handles payment URI generation, QR code creation, and transaction monitoring.
 */

import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"

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
     This returns PROCESSING as a placeholder
  -------------------------------- */

  async getPaymentStatus() {
    // Solana payments are monitored via blockchain
    // This is a placeholder - actual status comes from paymentWatcher
    return {
      status: "PROCESSING" as const
    }
  },

  /* --------------------------------
     VERIFY WEBHOOK
     Solana Pay doesn't use webhooks
     Returns true by default
  -------------------------------- */

  verifyWebhook(payload: unknown, signature?: string, rawBody?: string) {
    void payload
    void signature
    void rawBody
    // Solana Pay uses blockchain confirmations, not webhooks
    return true
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

    return {
      paymentId: reference,
      event: "payment.pending" as const
    }
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