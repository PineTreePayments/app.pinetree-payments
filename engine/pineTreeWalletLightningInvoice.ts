/**
 * Server-only interface for generating a fresh Lightning invoice on a
 * merchant's own PineTree Wallet - the sweep destination. Never exposed as a
 * public route; only called internally by engine/lightningSweep.ts.
 *
 * Design note: PineTree Wallet (the Dynamic-embedded custodial wallet) has
 * no native BOLT11 receive capability in this codebase today - only an
 * unused `bitcoin_lightning_address` field exists. The one real, working
 * Lightning-invoice-generation mechanism already implemented and tested
 * here is NWC (Nostr Wallet Connect, "Bring Your Own Lightning Wallet") -
 * providers/lightning/nwcClient.ts's makeNwcInvoice, used when a merchant
 * has an NWC wallet connected and ready (make_invoice/lookup_invoice/
 * pay_invoice permissions). This module uses that real capability rather
 * than inventing a fake one. When the merchant has no ready NWC wallet, this
 * throws a typed "not configured" error instead of fabricating an invoice -
 * matching this whole feature's fail-closed posture for anything not
 * genuinely implemented yet. A native PineTree Wallet BOLT11 receive
 * capability, if built later, is a drop-in replacement for the body of
 * createMerchantLightningSweepInvoice - the exported interface would not
 * need to change.
 */

import { getMerchantNwcSetup } from "@/database/merchantProviders"
import { makeNwcInvoice } from "@/providers/lightning/nwcClient"

export class PineTreeWalletLightningReceiveNotConfiguredError extends Error {
  readonly merchantId: string

  constructor(merchantId: string) {
    super("This merchant has no ready PineTree Wallet Lightning receive capability configured.")
    this.name = "PineTreeWalletLightningReceiveNotConfiguredError"
    this.merchantId = merchantId
  }
}

export type CreateMerchantLightningSweepInvoiceInput = {
  merchantId: string
  amountSats: number
  sweepId: string
  expiresInSeconds?: number
}

export type MerchantLightningSweepInvoice = {
  invoice: string
  paymentHash: string
  amountSats: number
  expiresAt: string
  destinationWalletProfileId: string
}

const DEFAULT_INVOICE_EXPIRY_SECONDS = 900
const MIN_INVOICE_EXPIRY_SECONDS = 60

/**
 * Generates a brand-new BOLT11 invoice on the given merchant's own PineTree
 * Wallet Lightning receive capability - never another merchant's wallet,
 * never PineTree's own platform wallet. Every call creates a fresh invoice;
 * callers must never attempt to reuse an expired one (see
 * engine/lightningSweep.ts's invoice-expiry check before each retry).
 */
export async function createMerchantLightningSweepInvoice(
  input: CreateMerchantLightningSweepInvoiceInput
): Promise<MerchantLightningSweepInvoice> {
  if (!(input.amountSats > 0)) {
    throw new Error("createMerchantLightningSweepInvoice requires a positive amountSats.")
  }
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Error("createMerchantLightningSweepInvoice requires merchantId.")
  }

  const nwc = await getMerchantNwcSetup(merchantId)
  if (!nwc || !nwc.readiness.ready) {
    throw new PineTreeWalletLightningReceiveNotConfiguredError(merchantId)
  }

  const expirySeconds = Math.max(MIN_INVOICE_EXPIRY_SECONDS, input.expiresInSeconds ?? DEFAULT_INVOICE_EXPIRY_SECONDS)
  const amountMsat = Math.round(input.amountSats * 1000)

  const result = await makeNwcInvoice(
    nwc.nwcUri,
    amountMsat,
    `PineTree Lightning sweep ${input.sweepId}`,
    expirySeconds
  )

  const expiresAt = result.expiresAt
    ? new Date(result.expiresAt * 1000).toISOString()
    : new Date(Date.now() + expirySeconds * 1000).toISOString()

  return {
    invoice: result.invoice,
    paymentHash: result.paymentHash,
    amountSats: input.amountSats,
    expiresAt,
    destinationWalletProfileId: nwc.providerRowId,
  }
}
