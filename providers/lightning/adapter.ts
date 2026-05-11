import type { ProviderAdapter, ProviderCapabilities } from "@/types/provider"
import { registerProvider } from "@/engine/providerRegistry"
import { createLightningInvoice } from "./createInvoice"
import { translateLightningEvent } from "./translateEvent"
import { verifyLightningWebhook } from "./verifyWebhook"
import { LIGHTNING_NETWORK, type LightningProviderConfig } from "./types"

function envFlag(name: string): boolean {
  return String(process.env[name] || "").toLowerCase().trim() === "true"
}

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || "").trim()
    if (value) return value
  }
  return ""
}

function getLightningConfig(): LightningProviderConfig {
  // Speed platform credentials — env-only, never per-merchant.
  // SPEED_* is the canonical name; PINETREE_LIGHTNING_* kept as fallback.
  const providerKey = readEnv("SPEED_API_KEY", "PINETREE_LIGHTNING_PROVIDER_KEY")
  const apiBaseUrl =
    readEnv("SPEED_API_BASE_URL", "PINETREE_LIGHTNING_API_BASE_URL") ||
    "https://api.tryspeed.com"
  const webhookSecret = readEnv("SPEED_WEBHOOK_SECRET", "PINETREE_LIGHTNING_WEBHOOK_SECRET") || undefined
  const environment = readEnv("SPEED_ENVIRONMENT") || "production"
  const platformAccountId = readEnv("SPEED_PLATFORM_ACCOUNT_ID") || undefined

  const platformConfigured = Boolean(providerKey)
  const webhookConfigured = Boolean(webhookSecret)
  const speedAccountTransfersSupported = true

  const capabilities: ProviderCapabilities = {
    hostedCheckout: false,
    walletRails: false,
    webhooks: webhookConfigured,
    supportsLightningInvoice: platformConfigured && webhookConfigured,
    supportsFeeAtPaymentTime:
      platformConfigured &&
      webhookConfigured &&
      speedAccountTransfersSupported &&
      envFlag("PINETREE_LIGHTNING_SUPPORTS_FEE_AT_PAYMENT_TIME"),
    supportsSplitSettlement:
      platformConfigured &&
      webhookConfigured &&
      speedAccountTransfersSupported &&
      envFlag("PINETREE_LIGHTNING_SUPPORTS_SPLIT_SETTLEMENT"),
    supportsWebhookConfirmation: webhookConfigured,
    requiresKyc: "unknown",
    custodyModel: "provider"
  }

  return {
    providerKey,
    displayName:
      readEnv("PINETREE_LIGHTNING_PROVIDER_DISPLAY_NAME") || "Bitcoin Lightning",
    apiBaseUrl,
    webhookSecret,
    environment,
    platformAccountId,
    speedAccountTransfersSupported,
    capabilities
  }
}

const config = getLightningConfig()

const lightningEnabled = Boolean(
  config.providerKey &&
  config.capabilities.supportsLightningInvoice &&
  config.capabilities.supportsFeeAtPaymentTime &&
  config.capabilities.supportsSplitSettlement &&
  config.capabilities.supportsWebhookConfirmation
)

export const lightningAdapter: ProviderAdapter = {
  metadata: {
    adapterId: "lightning",
    displayName: config.displayName,
    supportedNetworks: lightningEnabled ? [LIGHTNING_NETWORK] : [],
    // No credentialKey — Speed platform credentials are env-only.
    // Merchants store only a Speed Account ID and Lightning Address, not a Speed API key.
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
        pinetreeWallet: input.pinetreeWallet
      },
      config
    )

    return invoice
  },

  async getLightningInvoiceStatus() {
    throw new Error(
      "Lightning invoice status polling is not implemented. Speed webhook confirmation is used instead."
    )
  },

  async getPaymentStatus(providerReference: string) {
    void providerReference
    throw new Error(
      "Lightning payment status polling is not implemented. Speed webhook confirmation is used instead."
    )
  },

  verifyWebhook(payload, signature, rawBody, headers) {
    return verifyLightningWebhook(payload, signature, rawBody, config, headers)
  },

  translateEvent(payload) {
    return translateLightningEvent(payload)
  }
}

registerProvider("lightning", lightningAdapter)
