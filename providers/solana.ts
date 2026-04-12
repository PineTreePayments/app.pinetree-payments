/**
 * Solana Pay Provider Adapter
 * 
 * Implements the ProviderAdapter interface for Solana Pay integration.
 * Handles payment URI generation, QR code creation, and transaction monitoring.
 */

import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"
import { getBestWalletForNetwork } from "@/database/merchantWallets"

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

async function resolveSolanaRecipientAddress(merchantId: string): Promise<string> {
  const wallet = await getBestWalletForNetwork(merchantId, "solana")

  if (wallet?.wallet_address) {
    return wallet.wallet_address
  }

  const envWallet = String(process.env.SOLANA_WALLET || "").trim()
  if (!envWallet) {
    throw new Error("Merchant Solana wallet not configured")
  }

  return envWallet
}

export const solanaAdapter: ProviderAdapter = {

  /* --------------------------------
     WALLET RAIL SUPPORT
     Returns merchant's Solana wallet address
  -------------------------------- */

  async getMerchantWallet(merchantId: string) {
    const address = await resolveSolanaRecipientAddress(merchantId)

    return {
      address,
      network: "solana"
    }
  },

  /* --------------------------------
     CREATE PAYMENT
     Generates a Solana Pay URI for payment
  -------------------------------- */

  async createPayment(input: {
    paymentId: string
    amount: number
    currency: string
    merchantId: string
  }) {
    try {
      const recipient = await resolveSolanaRecipientAddress(input.merchantId)

      // Build Solana Pay URI
      const uri = buildSolanaPayUri({
        recipient,
        amount: input.amount,
        label: "PineTree Payment",
        message: `Payment #${input.paymentId.slice(0, 8)}`,
        reference: input.paymentId
      })

      return {
        providerReference: input.paymentId,
        qrCodeUrl: uri,
        paymentUrl: uri
      }

    } catch (error) {
      console.error("Solana payment error:", error)
      throw error
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