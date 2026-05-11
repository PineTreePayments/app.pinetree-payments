import type { ProviderAdapter, ProviderCapabilities } from "@/types/provider"
import { registerProvider } from "@/engine/providerRegistry"
import { createLightningInvoice } from "./createInvoice"
import { translateLightningEvent } from "./translateEvent"
import { verifyLightningWebhook } from "./verifyWebhook"
import { LIGHTNING_NETWORK, type LightningProviderConfig } from "./types"

function envFlag(name: string): boolean {
  return String(process.env[name] || "").toLowerCase().trim() === "true"
}

function getLightningConfig(): LightningProviderConfig {
  const providerKey = String(process.env.PINETREE_LIGHTNING_PROVIDER_KEY || "lightning").toLowerCase().trim()

  const capabilities: ProviderCapabilities = {
    hostedCheckout: false,
    walletRails: false,
    webhooks: envFlag("PINETREE_LIGHTNING_SUPPORTS_WEBHOOK_CONFIRMATION"),
    supportsLightningInvoice: Boolean(providerKey),
    supportsFeeAtPaymentTime: envFlag("PINETREE_LIGHTNING_SUPPORTS_FEE_AT_PAYMENT_TIME"),
    supportsSplitSettlement: envFlag("PINETREE_LIGHTNING_SUPPORTS_SPLIT_SETTLEMENT"),
    supportsWebhookConfirmation: envFlag("PINETREE_LIGHTNING_SUPPORTS_WEBHOOK_CONFIRMATION"),
    requiresKyc: "unknown",
    custodyModel: "unknown"
  }

  return {
    providerKey,
    displayName: process.env.PINETREE_LIGHTNING_PROVIDER_DISPLAY_NAME || "Bitcoin Lightning",
    apiBaseUrl: process.env.PINETREE_LIGHTNING_API_BASE_URL,
    webhookSecret: process.env.PINETREE_LIGHTNING_WEBHOOK_SECRET,
    capabilities
  }
}

const config = getLightningConfig()
const lightningEnabled = Boolean(
  config.providerKey &&
  config.capabilities.supportsLightningInvoice &&
  config.capabilities.supportsFeeAtPaymentTime &&
  config.capabilities.supportsSplitSettlement
)

export const lightningAdapter: ProviderAdapter = {
  metadata: {
    adapterId: "lightning",
    displayName: config.displayName,
    supportedNetworks: lightningEnabled ? [LIGHTNING_NETWORK] : [],
    credentialKey: "lightning_api_key",
    feeCaptureMethods: lightningEnabled ? ["invoice_split"] : [],
    capabilities: config.capabilities
  },

  async createLightningInvoice(input) {
    return createLightningInvoice(input, config)
  },

  async createPayment(input) {
    const invoice = await createLightningInvoice(
      {
        paymentId: input.paymentId,
        merchantId: input.merchantId || "",
        merchantAmount: input.merchantAmount,
        pinetreeFee: input.pinetreeFee,
        grossAmount: input.grossAmount,
        currency: input.currency,
        merchantWallet: input.merchantWallet,
        pinetreeWallet: input.pinetreeWallet,
        providerApiKey: input.providerApiKey
      },
      config
    )

    return invoice
  },

  async getLightningInvoiceStatus() {
    throw new Error("Lightning invoice status polling is not implemented for this PSP yet")
  },

  async getPaymentStatus(providerReference: string) {
    void providerReference
    throw new Error("Lightning payment status polling is not implemented for this PSP yet")
  },

  verifyWebhook(payload, signature, rawBody) {
    return verifyLightningWebhook(payload, signature, rawBody, config)
  },

  translateEvent(payload) {
    return translateLightningEvent(payload)
  }
}

registerProvider("lightning", lightningAdapter)
