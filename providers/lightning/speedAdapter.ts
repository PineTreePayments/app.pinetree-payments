/**
 * PineTree Speed Lightning Provider Adapter
 *
 * PineTree creates the Speed payment with its own platform API key. Legacy mode
 * routes merchant proceeds to a merchant Speed account; treasury-sweep mode
 * keeps Speed hidden and settles merchant net funds to PineTree Wallet BTC.
 */

import type { ProviderAdapter, ProviderCapabilities, LightningInvoiceRequest } from "@/types/provider"
import { registerProvider } from "@/providers/registry"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { resolveSpeedHeaderAccountId } from "./speedHeaderAccountResolver"
import {
  createSpeedLightningPayment,
  retrieveSpeedPayment,
  verifySpeedWebhookSignature,
  isSpeedPaymentPaid,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE
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

export function normalizeSpeedStatus(status: string) {
  const normalized = status.toLowerCase().trim()
  if (normalized === "paid" || normalized === "confirmed") return "CONFIRMED" as const
  if (normalized === "processing" || normalized === "settling") return "PROCESSING" as const
  if (normalized === "pending" || normalized === "unpaid" || normalized === "created") return "PENDING" as const
  if (normalized === "expired") return "EXPIRED" as const
  if (normalized === "cancelled" || normalized === "canceled") return "INCOMPLETE" as const
  console.warn("[speed] unknown payment status", { providerStatus: normalized || null })
  return "UNKNOWN" as const
}

async function resolveMerchantSpeedAccount(merchantId: string): Promise<string> {
  const profile = await getMerchantLightningProfile(merchantId)
  if (!profile || profile.status !== "ready") {
    throw new Error("Speed Lightning is not ready for this merchant.")
  }
  return resolveSpeedHeaderAccountId(profile)
}

export async function retrieveMerchantSpeedPayment(paymentId: string, merchantId: string) {
  const connectedAccountId = await resolveMerchantSpeedAccount(merchantId)
  return retrieveSpeedPayment(paymentId, {
    merchantId,
    connectedAccountId,
    operation: "payment.retrieve",
  })
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
    const treasurySweepEnabled = isSpeedPlatformTreasurySweepEnabled()
    const merchantSpeedAccountId = treasurySweepEnabled
      ? ""
      : await resolveMerchantSpeedAccount(input.merchantId)

    const speedPayment = await createSpeedLightningPayment({
      amount: Number(input.grossAmount),
      currency: input.currency || "USD",
      merchantAmount: Number(input.merchantAmount),
      pineTreeFeeAmount: Number(input.pinetreeFee),
      merchantSpeedAccountId,
      pineTreePaymentId: input.paymentId,
      pineTreePaymentIntentId: String(input.metadata?.paymentIntentId || ""),
      merchantId: input.merchantId,
      settlementMode: treasurySweepEnabled
        ? SPEED_PLATFORM_TREASURY_SWEEP_MODE
        : "speed_connect_split",
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
      feeCaptureMethod: treasurySweepEnabled ? "collection_then_settle" : "invoice_split",
      metadata: {
        provider: SPEED_ADAPTER_ID,
        speedPaymentId: speedPayment.speedPaymentId,
        speedStatus: speedPayment.status,
        settlementMode: treasurySweepEnabled
          ? SPEED_PLATFORM_TREASURY_SWEEP_MODE
          : "speed_connect_split",
        ...(merchantSpeedAccountId ? { merchantSpeedAccountId } : {}),
        merchantTransferPercentage: speedPayment.merchantTransferPercentage,
        transfers: speedPayment.transfers,
        feeStatus: treasurySweepEnabled
          ? "platform_fee_retained_pending_sweep"
          : speedPayment.transfers.length > 0 ? "split_configured" : "split_pending_verification",
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

  async getLightningInvoiceStatus(providerReference: string, merchantId?: string) {
    if (!merchantId) throw new Error("Merchant ID is required for Speed payment retrieval.")
    const payment = await retrieveMerchantSpeedPayment(providerReference, merchantId)
    return { status: normalizeSpeedStatus(String(payment.status || "")) }
  },

  async getPaymentStatus(providerReference: string, merchantId?: string) {
    if (!merchantId) throw new Error("Merchant ID is required for Speed payment retrieval.")
    const payment = await retrieveMerchantSpeedPayment(providerReference, merchantId)
    return { status: normalizeSpeedStatus(String(payment.status || "")) }
  },

  verifyWebhook(payload, _signature, rawBody, headers) {
    return verifySpeedWebhookSignature(rawBody || "", headers || {}, payload)
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

    if (eventType === "payment.expired") {
      return {
        paymentId,
        event: "payment.expired"
      }
    }

    if (eventType === "payment.cancelled" || eventType === "payment.canceled") {
      return {
        paymentId,
        event: "payment.canceled"
      }
    }

    if (
      eventType === "payment.processing" ||
      eventType === "payment.settling" ||
      status.toLowerCase() === "processing" ||
      status.toLowerCase() === "settling"
    ) {
      return {
        paymentId,
        event: "payment.processing"
      }
    }

    if (
      eventType === "payment.pending" ||
      eventType === "payment.created" ||
      status.toLowerCase() === "pending" ||
      status.toLowerCase() === "unpaid" ||
      status.toLowerCase() === "created"
    ) {
      return {
        paymentId,
        event: "payment.pending"
      }
    }

    console.warn("[speed] unknown payment event", {
      providerEvent: eventType || null,
      providerStatus: status || null,
      paymentId: paymentId || null
    })
    return null
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
