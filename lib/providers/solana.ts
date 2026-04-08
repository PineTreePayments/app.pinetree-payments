/**
 * Solana Pay Provider Adapter
 * 
 * Implements the ProviderAdapter interface for Solana Pay integration.
 * Handles payment URI generation, QR code creation, and transaction monitoring.
 */

import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"
import { getMerchantCredential } from "@/lib/database/merchants"
import { getReturnPath } from "../engine/config"

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

export const solanaAdapter: ProviderAdapter = {

  /* --------------------------------
     WALLET RAIL SUPPORT
     Returns merchant's Solana wallet address
  -------------------------------- */

  async getMerchantWallet(merchantId: string) {
    const walletAddress = await getMerchantCredential(
      merchantId,
      "solana_wallet"
    )

    if (!walletAddress) {
      // Fallback to environment variable
      const envWallet = process.env.SOLANA_WALLET
      if (!envWallet) {
        throw new Error("Merchant Solana wallet not configured")
      }
      return {
        address: envWallet,
        network: "solana"
      }
    }

    return {
      address: walletAddress,
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
      // Get merchant wallet directly
      let recipient = await getMerchantCredential(
        input.merchantId,
        "solana_wallet"
      )

      if (!recipient) {
        // Fallback to environment variable
        recipient = process.env.SOLANA_WALLET
        if (!recipient) {
          throw new Error("Solana wallet not configured")
        }
      }

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
        qrCode: uri,
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

  async getPaymentStatus(providerReference: string) {
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

  verifyWebhook(payload: any, signature?: string) {
    // Solana Pay uses blockchain confirmations, not webhooks
    return true
  },

  /* --------------------------------
     TRANSLATE EVENT
     Converts Solana payment events to PineTree events
  -------------------------------- */

  translateEvent(payload: any) {
    const reference = payload.reference || payload.paymentId || ""

    if (payload.confirmed) {
      return {
        paymentId: reference,
        event: "payment.confirmed" as const
      }
    }

    if (payload.detected) {
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
function buildSolanaPayUri(params: SolanaPayParams): string {
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