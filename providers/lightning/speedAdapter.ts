/**
 * PineTree Speed Lightning Provider Adapter
 *
 * Default BTC Lightning path. PineTree creates the Speed payment with its own
 * platform API key, customer pays the gross total, and Speed routes the merchant
 * percentage to the merchant's configured Speed account ID.
 */

import type { ProviderAdapter, ProviderCapabilities, LightningInvoiceRequest } from "@/types/provider"
import { registerProvider } from "@/engine/providerRegistry"
import {
  SPEED_PROVIDER_NAME,
  getMerchantSpeedProvider
} from "@/database/merchantProviders"
import {
  createSpeedLightningPayment,
  retrieveSpeedPayment,
  verifySpeedWebhookSignature,
  isSpeedPaymentPaid
} from "./speedClient"
import QRCode from "qrcode"

export const SPEED_NETWORK = "bitcoin_lightning"
export const SPEED_ADAPTER_ID = SPEED_PROVIDER_NAME

const speedCapabilities: ProviderCapabilities = {
  hostedCheckout: false,
  walletRails: false,
  webhooks: true,
  supportsLightningInvoice: true,
  supportsFeeAtPaymentTime: true,
  supportsSplitSettlement: true,
  supportsWebhookConfirmation: true,
  requiresKyc: "unknown",
  custodyModel: "provider"
}

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function getSpeedObject(payload: unknown): Record<string, unknown> {
  const object =
    readPath(payload, ["data", "object"]) ||
    readPath(payload, ["event", "data", "object"]) ||
    payload
  return object && typeof object === "object" ? object as Record<string, unknown> : {}
}

function getSpeedEventType(payload: unknown): string {
  return String(
    readPath(payload, ["event_type"]) ||
      readPath(payload, ["type"]) ||
      readPath(payload, ["event", "type"]) ||
      ""
  )
}

function getMetadata(payload: unknown): Record<string, unknown> {
  const object = getSpeedObject(payload)
  const metadata = object.metadata
  return metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {}
}

function normalizeSpeedStatus(status: string) {
  const normalized = status.toLowerCase().trim()
  if (normalized === "paid" || normalized === "confirmed") return "CONFIRMED" as const
  if (normalized === "expired" || normalized === "cancelled" || normalized === "canceled") return "EXPIRED" as const
  return "PENDING" as const
}

export const speedAdapter: ProviderAdapter = {
  metadata: {
    adapterId: SPEED_ADAPTER_ID,
    displayName: "Speed Lightning",
    supportedNetworks: [SPEED_NETWORK],
    feeCaptureMethods: ["invoice_split"],
    capabilities: speedCapabilities
  },

  async createLightningInvoice(input: LightningInvoiceRequest) {
    const merchantSpeed = await getMerchantSpeedProvider(input.merchantId)
    const merchantSpeedAccountId = merchantSpeed?.accountId || input.merchantWallet || ""
    if (!merchantSpeedAccountId) {
      throw new Error("Merchant Speed Account ID is required for Speed Lightning payments.")
    }
    if (!merchantSpeed?.readyForPayments) {
      throw new Error("Speed Lightning is not ready for this merchant. Run the Speed setup test and save a Merchant Speed Account ID.")
    }

    const speedPayment = await createSpeedLightningPayment({
      amount: Number(input.grossAmount),
      currency: input.currency || "USD",
      merchantAmount: Number(input.merchantAmount),
      pineTreeFeeAmount: Number(input.pinetreeFee),
      merchantSpeedAccountId,
      pineTreePaymentId: input.paymentId,
      pineTreePaymentIntentId: String(input.metadata?.paymentIntentId || ""),
      merchantId: input.merchantId,
      metadata: input.metadata
    })

    const qrCodeUrl = await QRCode.toDataURL(speedPayment.paymentUrl.toUpperCase(), {
      errorCorrectionLevel: "M",
      margin: 2
    })

    return {
      providerReference: speedPayment.speedPaymentId,
      invoice: speedPayment.paymentRequest,
      paymentUrl: speedPayment.paymentUrl,
      qrCodeUrl,
      feeCaptureMethod: "invoice_split",
      metadata: {
        provider: SPEED_ADAPTER_ID,
        speedPaymentId: speedPayment.speedPaymentId,
        speedStatus: speedPayment.status,
        merchantSpeedAccountId,
        merchantTransferPercentage: speedPayment.merchantTransferPercentage,
        transfers: speedPayment.transfers,
        feeStatus: speedPayment.transfers.length > 0 ? "split_configured" : "split_pending_verification",
        grossAmount: Number(input.grossAmount),
        merchantAmount: Number(input.merchantAmount),
        pineTreeFeeAmount: Number(input.pinetreeFee)
      }
    }
  },

  async createPayment(input) {
    return this.createLightningInvoice!({
      paymentId: input.paymentId,
      merchantId: input.merchantId || "",
      merchantAmount: input.merchantAmount,
      pinetreeFee: input.pinetreeFee,
      grossAmount: input.grossAmount,
      currency: input.currency,
      merchantWallet: input.merchantWallet,
      pinetreeWallet: input.pinetreeWallet
    })
  },

  async getLightningInvoiceStatus(providerReference: string) {
    const payment = await retrieveSpeedPayment(providerReference)
    return { status: normalizeSpeedStatus(String(payment.status || "")) }
  },

  async getPaymentStatus(providerReference: string) {
    const payment = await retrieveSpeedPayment(providerReference)
    return { status: normalizeSpeedStatus(String(payment.status || "")) }
  },

  verifyWebhook(_payload, _signature, rawBody, headers) {
    return verifySpeedWebhookSignature(rawBody || "", headers || {})
  },

  translateEvent(payload) {
    const eventType = getSpeedEventType(payload)
    const object = getSpeedObject(payload)
    const metadata = getMetadata(payload)
    const paymentId = String(metadata.pineTreePaymentId || "").trim()
    const status = String(object.status || "").trim()

    if (
      eventType === "payment.paid" ||
      eventType === "payment.confirmed" ||
      eventType === "checkout_session.paid" ||
      eventType === "checkout_session.payment_paid" ||
      isSpeedPaymentPaid({ status: status || String(object.payment_status || "") })
    ) {
      return {
        paymentId,
        event: "payment.confirmed"
      }
    }

    if (eventType === "payment.expired" || eventType === "payment.cancelled") {
      return {
        paymentId,
        event: "payment.failed"
      }
    }

    return {
      paymentId,
      event: "payment.pending"
    }
  },

  async healthCheck() {
    try {
      await retrieveSpeedPayment("healthcheck")
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return !message.includes("missing SPEED_API_KEY") && !message.includes("401")
    }
  }
}

registerProvider(SPEED_ADAPTER_ID, speedAdapter)
