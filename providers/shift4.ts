/**
 * Shift4 Crypto Provider Adapter
 * 
 * Implements the ProviderAdapter interface for Shift4 crypto payment integration.
 * Handles payment session creation, status checking, and event translation.
 */

import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"
import { setProviderHealth } from "../engine/providerRegistry"
import { getMerchantCredential } from "@/database/merchants"
import crypto from "crypto"

/**
 * Shift4 API base URL
 */
const SHIFT4_API_BASE = "https://api.shift4.com"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a || ""))
  const right = Buffer.from(String(b || ""))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

export const shift4Adapter: ProviderAdapter = {

  /* --------------------------------
     WALLET RAIL SUPPORT
     Shift4 uses hosted payment sessions
     Returns a placeholder wallet
  -------------------------------- */

  async getMerchantWallet(merchantId: string) {
    // Shift4 doesn't use direct wallet addresses
    // Return a placeholder for compatibility
    return {
      address: `shift4_${merchantId}`,
      network: "shift4"
    }
  },

  /* --------------------------------
     CREATE PAYMENT
     Creates a crypto payment session via Shift4 API
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
        "shift4_api_key"
      )

      if (!apiKey) {
        throw new Error("Shift4 API key not configured")
      }

      const response = await fetch(`${SHIFT4_API_BASE}/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          amount: Math.round(input.amount * 100), // Amount in cents
          currency: input.currency,
          metadata: {
            paymentId: input.paymentId
          }
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || "Shift4 API error")
      }

      setProviderHealth("shift4", true)

      return {
        providerReference: data.id,
        paymentUrl: data.hosted_payment_url
      }

    } catch (error) {
      console.error("Shift4 payment error:", error)
      setProviderHealth("shift4", false)
      throw error
    }
  },

  /* --------------------------------
     GET PAYMENT STATUS
     Queries Shift4 API for payment status
  -------------------------------- */

  async getPaymentStatus(providerReference: string) {
    try {
      const apiKey = process.env.SHIFT4_API_KEY

      if (!apiKey) {
        return { status: "PENDING" as const }
      }

      const response = await fetch(
        `${SHIFT4_API_BASE}/payments/${providerReference}`,
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`
          }
        }
      )

      const data = await response.json()
      const status = data.status

      return shift4StatusToPineTree(status)

    } catch (error) {
      console.error("Shift4 status check error:", error)
      return { status: "PENDING" as const }
    }
  },

  /* --------------------------------
     VERIFY WEBHOOK
     Validates Shift4 webhook signature
  -------------------------------- */

  verifyWebhook(payload: unknown, signature?: string, rawBody?: string) {
    const secret = String(process.env.SHIFT4_WEBHOOK_SHARED_SECRET || "").trim()
    const provided = String(signature || "").trim()

    if (!secret || !provided) {
      return false
    }

    const body =
      typeof rawBody === "string"
        ? rawBody
        : JSON.stringify(payload || {})

    const expected = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex")

    return safeEqual(expected, provided)
  },

  /* --------------------------------
     TRANSLATE EVENT
     Converts Shift4 events to PineTree events
  -------------------------------- */

  translateEvent(payload: unknown) {
    const source = isRecord(payload) ? payload : {}
    const metadata = isRecord(source.metadata) ? source.metadata : {}
    const payment = isRecord(source.payment) ? source.payment : {}

    const event = String(source.type || "")
    const paymentId = String(metadata.paymentId || payment.id || "")

    // Translate Shift4 events to PineTree events
    switch (event) {
      case "payment.created":
        return {
          paymentId,
          event: "payment.pending" as const
        }

      case "payment.pending":
        return {
          paymentId,
          event: "payment.processing" as const
        }

      case "payment.completed":
      case "payment.settled":
        return {
          paymentId,
          event: "payment.confirmed" as const
        }

      case "payment.failed":
      case "payment.declined":
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
 * Convert Shift4 status to PineTree status
 */
function shift4StatusToPineTree(status: string) {
  switch (status) {
    case "pending":
    case "authorized":
      return { status: "PENDING" as const }
    case "processing":
    case "settling":
      return { status: "PROCESSING" as const }
    case "captured":
    case "settled":
    case "completed":
      return { status: "CONFIRMED" as const }
    case "failed":
    case "declined":
    case "voided":
      return { status: "FAILED" as const }
    default:
      return { status: "PENDING" as const }
  }
}

// Register the adapter
registerProvider("shift4", shift4Adapter)