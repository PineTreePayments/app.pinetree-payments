/**
 * PineTree NWC Provider Adapter
 *
 * Registers "lightning_nwc" as a ProviderAdapter.
 * Merchant NWC wallet creates invoices; PineTree fee is collected post-payment
 * via a separate pay_invoice call (see engine/lightningNwc.ts).
 *
 * Fee model: merchant receives full payment; PineTree charges fee after confirmation (post_payment_nwc).
 */

import type { ProviderAdapter, ProviderCapabilities, LightningInvoiceRequest, LightningInvoiceStatus } from "@/types/provider"
import { registerProvider } from "@/providers/registry"
import { makeNwcInvoice, validateNwcUri } from "./nwcClient"
import QRCode from "qrcode"

export const NWC_NETWORK = "bitcoin_lightning"
export const NWC_ADAPTER_ID = "lightning_nwc"

const nwcCapabilities: ProviderCapabilities = {
  hostedCheckout: false,
  walletRails: false,
  webhooks: false,
  supportsLightningInvoice: true,
  // Fee is NOT captured at payment time — it is collected post-payment via NWC pay_invoice.
  supportsFeeAtPaymentTime: false,
  supportsSplitSettlement: false,
  supportsWebhookConfirmation: false,
  requiresKyc: false,
  custodyModel: "self_custody" as const
}

export const nwcAdapter: ProviderAdapter = {
  metadata: {
    adapterId: NWC_ADAPTER_ID,
    displayName: "Bitcoin Lightning",
    supportedNetworks: [NWC_NETWORK],
    feeCaptureMethods: [],
    capabilities: nwcCapabilities
  },

  async createLightningInvoice(input: LightningInvoiceRequest) {
    const nwcUri = input.nwcUri
    if (!nwcUri) {
      throw new Error("NWC adapter requires nwcUri in invoice input")
    }

    const { valid, error } = validateNwcUri(nwcUri)
    if (!valid) {
      throw new Error(`Invalid NWC connection: ${error}`)
    }

    // Convert gross USD amount to millisatoshis. The merchant wallet receives
    // the gross customer payment first; PineTree collects its fee separately
    // after invoice settlement through NWC pay_invoice.
    const btcPriceUsd = input.btcPriceUsd
    if (!btcPriceUsd || btcPriceUsd <= 0) {
      throw new Error("NWC adapter requires btcPriceUsd to convert USD amount to sats")
    }

    const amountUsd = Number(input.grossAmount)
    const amountSats = Math.ceil((amountUsd / btcPriceUsd) * 100_000_000)
    const amountMsat = amountSats * 1000

    const description = `PineTree payment ${input.paymentId}`

    const invoiceResult = await makeNwcInvoice(nwcUri, amountMsat, description)

    let qrCodeUrl = ""
    try {
      qrCodeUrl = await QRCode.toDataURL(invoiceResult.invoice.toUpperCase(), {
        errorCorrectionLevel: "M",
        margin: 2
      })
    } catch {
      // QR generation failure is non-fatal
    }

    return {
      providerReference: invoiceResult.paymentHash,
      invoice: invoiceResult.invoice,
      paymentHash: invoiceResult.paymentHash,
      paymentUrl: `lightning:${invoiceResult.invoice}`,
      qrCodeUrl,
      expiresAt: invoiceResult.expiresAt
        ? new Date(invoiceResult.expiresAt * 1000).toISOString()
        : undefined,
      feeCaptureMethod: "post_payment_nwc",
      metadata: {
        provider: NWC_ADAPTER_ID,
        amountSats,
        amountMsat,
        btcPriceUsd,
        invoiceAmountUsd: amountUsd,
        merchantAmountUsd: Number(input.merchantAmount),
        pinetreeFeeUsd: Number(input.pinetreeFee),
        createdAt: invoiceResult.createdAt
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
      pinetreeWallet: input.pinetreeWallet,
      nwcUri: (input as { nwcUri?: string }).nwcUri,
      btcPriceUsd: (input as { btcPriceUsd?: number }).btcPriceUsd
    })
  },

  async getLightningInvoiceStatus(providerReference: string) {
    void providerReference
    throw new Error(
      "NWC Lightning: getLightningInvoiceStatus requires nwcUri — call lookupNwcInvoice directly from the payment checker"
    )
    return { status: "PENDING" as LightningInvoiceStatus }
  },

  async getPaymentStatus(providerReference: string) {
    void providerReference
    throw new Error(
      "NWC Lightning: use getLightningInvoiceStatus with payment_hash instead"
    )
  },

  verifyWebhook() {
    throw new Error("NWC Lightning does not use webhooks — status is polled via NWC")
  },

  translateEvent(payload) {
    void payload
    throw new Error("NWC Lightning does not use webhook event translation")
  }
}

registerProvider(NWC_ADAPTER_ID, nwcAdapter)
