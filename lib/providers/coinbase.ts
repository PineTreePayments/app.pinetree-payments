/**
 * Coinbase Commerce Provider Adapter
 * 
 * Implements the ProviderAdapter interface for Coinbase Commerce integration.
 * Handles payment creation, status checking, webhook verification, and event translation.
 */

import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"
import { setProviderHealth } from "../engine/providerRegistry"
import { getMerchantCredential } from "@/lib/database/merchants"

/**
 * Coinbase Commerce API base URL
 */
const COINBASE_API_BASE = "https://api.commerce.coinbase.com"

/**
 * Coinbase Event Types
 */
type CoinbaseEventType = 
  | "charge:created"
  | "charge:pending"
  | "charge:confirmed"
  | "charge:resolved"
  | "charge:failed"

/**
 * Coinbase Charge Status
 */
type CoinbaseStatus = "NEW" | "PENDING" | "COMPLETED" | "RESOLVED" | "EXPIRED" | "CANCELED"

export const coinbaseAdapter: ProviderAdapter = {

  /* --------------------------------
     WALLET RAIL SUPPORT
     Returns merchant's Coinbase wallet address
  -------------------------------- */

  async getMerchantWallet(merchantId: string) {
    const walletAddress = await getMerchantCredential(
      merchantId,
      "coinbase_wallet"
    )

    if (!walletAddress) {
      throw new Error("Merchant Coinbase wallet not configured")
    }

    return {
      address: walletAddress,
      network: "base"
    }
  },

  /* --------------------------------
     CREATE PAYMENT
     Creates a new charge via Coinbase Commerce API
  -------------------------------- */

  async createPayment(input: {
    paymentId: string
    amount: number
    currency: string
    merchantId: string
  }) {
    try {
      const apiKey = await getMerchantCredential(
        input.merchantId,
        "coinbase_api_key"
      )

      if (!apiKey) {
        throw new Error("Coinbase API key not configured")
      }

      const response = await fetch(`${COINBASE_API_BASE}/charges`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CC-Api-Key": apiKey,
          "X-CC-Version": "2018-03-22"
        },
        body: JSON.stringify({
          name: "PineTree Payment",
          description: "Point of Sale Transaction",
          pricing_type: "fixed_price",
          local_price: {
            amount: input.amount.toFixed(2),
            currency: input.currency
          },
          metadata: {
            paymentId: input.paymentId
          }
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || "Coinbase API error")
      }

      // Safety check
      if (!data?.data?.id) {
        throw new Error("Invalid Coinbase response")
      }

      setProviderHealth("coinbase", true)

      return {
        providerReference: data.data.id,
        paymentUrl: data.data.hosted_url
      }

    } catch (error) {
      console.error("Coinbase payment error:", error)
      setProviderHealth("coinbase", false)
      throw error
    }
  },

  /* --------------------------------
     GET PAYMENT STATUS
     Queries Coinbase API for current charge status
  -------------------------------- */

  async getPaymentStatus(providerReference: string) {
    try {
      const response = await fetch(
        `${COINBASE_API_BASE}/charges/${providerReference}`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-CC-Version": "2018-03-22"
          }
        }
      )

      const data = await response.json()
      const status = data?.data?.timeline?.slice(-1)[0]?.status as CoinbaseStatus

      return coinbaseStatusToPineTree(status)

    } catch (error) {
      console.error("Coinbase status check error:", error)
      return { status: "PENDING" as const }
    }
  },

  /* --------------------------------
     VERIFY WEBHOOK
     Validates webhook signature (basic implementation)
  -------------------------------- */

  verifyWebhook(payload: any, signature?: string) {
    // TODO: Implement proper signature verification
    // For now, accept all webhooks
    return true
  },

  /* --------------------------------
     TRANSLATE EVENT
     Converts Coinbase events to PineTree standardized events
  -------------------------------- */

  translateEvent(payload: any) {
    const event = payload?.event?.type as CoinbaseEventType

    // Extract payment ID from metadata
    const paymentId = payload?.event?.data?.metadata?.paymentId || ""

    // Translate Coinbase events to PineTree events
    switch (event) {
      case "charge:created":
        return {
          paymentId,
          event: "payment.pending" as const
        }

      case "charge:pending":
        return {
          paymentId,
          event: "payment.processing" as const
        }

      case "charge:confirmed":
      case "charge:resolved":
        return {
          paymentId,
          event: "payment.confirmed" as const
        }

      case "charge:failed":
        return {
          paymentId,
          event: "payment.failed" as const
        }

      default:
        return {
          paymentId,
          event: "payment.pending" as const
        }
    }
  }
}

/**
 * Convert Coinbase status to PineTree status
 */
function coinbaseStatusToPineTree(status: CoinbaseStatus) {
  switch (status) {
    case "NEW":
      return { status: "PENDING" as const }
    case "PENDING":
      return { status: "PROCESSING" as const }
    case "COMPLETED":
    case "RESOLVED":
      return { status: "CONFIRMED" as const }
    case "EXPIRED":
    case "CANCELED":
      return { status: "FAILED" as const }
    default:
      return { status: "PENDING" as const }
  }
}

// Register the adapter
registerProvider("coinbase", coinbaseAdapter)