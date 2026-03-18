import { ProviderAdapter } from "@/types/provider"
import { registerProvider } from "../engine/providerRegistry"
import { setProviderHealth } from "../engine/providerHealth"
import { getProviderCredential } from "../engine/getProviderCredential"

export const coinbaseAdapter: ProviderAdapter = {

  /* --------------------------------
  WALLET RAIL SUPPORT
  -------------------------------- */

  async getMerchantWallet(merchantId: string) {

    const walletAddress = await getProviderCredential(
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
  LEGACY COINBASE INVOICE FLOW
  (kept for fallback compatibility)
  -------------------------------- */

  async createPayment(input: {
    paymentId: string
    amount: number
    currency: string
    merchantId: string
  }) {

    try {

      const apiKey = await getProviderCredential(
        input.merchantId,
        "coinbase"
      )

      const response = await fetch(
        "https://api.commerce.coinbase.com/charges",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CC-Api-Key": apiKey
          },
          body: JSON.stringify({
            name: "PineTree Payment",
            pricing_type: "fixed_price",
            local_price: {
              amount: input.amount,
              currency: input.currency
            },
            metadata: {
              paymentId: input.paymentId
            }
          })
        }
      )

      const data = await response.json()

      /* SAFETY CHECK */

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
  PAYMENT STATUS CHECK
  -------------------------------- */

  async getPaymentStatus(providerReference: string) {

    const response = await fetch(
      `https://api.commerce.coinbase.com/charges/${providerReference}`,
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    )

    const data = await response.json()

    const status = data?.data?.timeline?.slice(-1)[0]?.status

    if (status === "NEW") return { status: "PENDING" }
    if (status === "PENDING") return { status: "PROCESSING" }
    if (status === "COMPLETED") return { status: "CONFIRMED" }
    if (status === "RESOLVED") return { status: "CONFIRMED" }

    return { status: "FAILED" }

  },

  /* --------------------------------
  WEBHOOK VERIFY
  -------------------------------- */

  verifyWebhook(payload: any, signature?: string) {

    // Can implement Coinbase signature verification later
    return true

  },

  /* --------------------------------
  WEBHOOK EVENT TRANSLATION
  -------------------------------- */

  translateEvent(payload: any) {

    const event = payload?.event?.type

    if (event === "charge:pending")
      return {
        paymentId: payload.event.data.metadata.paymentId,
        event: "payment.processing"
      }

    if (event === "charge:confirmed")
      return {
        paymentId: payload.event.data.metadata.paymentId,
        event: "payment.confirmed"
      }

    if (event === "charge:resolved")
      return {
        paymentId: payload.event.data.metadata.paymentId,
        event: "payment.confirmed"
      }

    if (event === "charge:failed")
      return {
        paymentId: payload.event.data.metadata.paymentId,
        event: "payment.failed"
      }

    return {
      paymentId: "",
      event: "payment.pending"
    }

  }

}

registerProvider("coinbase", coinbaseAdapter)