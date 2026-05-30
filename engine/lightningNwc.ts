/**
 * PineTree Lightning NWC Engine
 *
 * Business logic for the Direct Lightning Wallet (NWC) rail:
 * - Invoice amount conversion (USD → sats)
 * - Post-payment PineTree fee collection via merchant NWC wallet
 * - Fee status tracking separate from customer payment status
 *
 * Architecture rules:
 * - This engine layer calls the NWC provider adapter (not the client directly)
 * - Only this layer updates DB records
 * - Fee failure does NOT fail the customer payment
 */

import { supabaseAdmin, supabase } from "@/database"
import { createLedgerEntry } from "@/database/ledgerEntries"
import { getMerchantNwcSetup } from "@/database/merchantProviders"
import { payNwcInvoice, maskNwcUri } from "@/providers/lightning/nwcClient"
import { getMarketPricesUSD } from "./marketPrices"
import { PINETREE_FEE } from "./config"

const db = supabaseAdmin || supabase

// ─── Types ───────────────────────────────────────────────────────────────────

export type NwcFeeStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "PAID"
  | "FAILED"
  | "RETRY_REQUIRED"

export type NwcFeeCollectionResult = {
  status: NwcFeeStatus
  preimage?: string
  feeAmountSats?: number
  errorMessage?: string
}

// ─── USD → Sats Conversion ────────────────────────────────────────────────────

/**
 * Convert a USD amount to satoshis using the current BTC/USD market price.
 * Always rounds up to ensure PineTree collects at least the configured fee.
 */
export async function getFeeAmountSats(feeUsd: number = PINETREE_FEE): Promise<{
  feeAmountSats: number
  btcPriceUsd: number
}> {
  const prices = await getMarketPricesUSD()
  const btcPriceUsd = prices.BTC

  if (!btcPriceUsd || btcPriceUsd <= 0) {
    throw new Error("BTC price unavailable — cannot convert fee to sats")
  }

  const feeAmountSats = Math.ceil((feeUsd / btcPriceUsd) * 100_000_000)

  return { feeAmountSats, btcPriceUsd }
}

function isExpectedFeeAmount(actualMsat: unknown, expectedSats: number): boolean {
  const actual = Number(actualMsat)
  if (!Number.isFinite(actual) || actual <= 0) return false
  return actual === expectedSats * 1000
}

// ─── Fee Collection ───────────────────────────────────────────────────────────

/**
 * After a customer payment is confirmed, attempt to collect the PineTree platform
 * fee from the merchant's NWC wallet by paying a PineTree treasury invoice.
 *
 * This is the post-payment fee model for NWC:
 *   1. Customer pays merchant invoice → merchant wallet receives BTC
 *   2. PineTree pays itself a fee invoice using the merchant's NWC wallet
 *
 * Fee failure is recorded separately. The customer payment remains CONFIRMED.
 *
 * Requires PINETREE_TREASURY_NWC_URI (PineTree treasury NWC connection) to be
 * set in environment. If not configured, fee collection is skipped and flagged.
 */
export async function collectNwcPlatformFee(
  paymentId: string,
  merchantId: string
): Promise<NwcFeeCollectionResult> {
  const treasuryNwcUri = process.env.PINETREE_TREASURY_NWC_URI?.trim() || ""

  if (!treasuryNwcUri) {
    console.warn("[nwc/fee] PINETREE_TREASURY_NWC_URI not configured — fee collection deferred", {
      paymentId
    })
    await recordFeeStatus(paymentId, "RETRY_REQUIRED", {
      reason: "CONFIGURATION_MISSING: PINETREE_TREASURY_NWC_URI not set"
    })
    return { status: "RETRY_REQUIRED", errorMessage: "PINETREE_TREASURY_NWC_URI not configured" }
  }

  const merchantNwc = await getMerchantNwcSetup(merchantId)
  if (!merchantNwc) {
    console.error("[nwc/fee] No NWC setup found for merchant", { paymentId, merchantId })
    await recordFeeStatus(paymentId, "FAILED", {
      reason: "Merchant NWC setup not found"
    })
    return { status: "FAILED", errorMessage: "Merchant NWC setup not found" }
  }

  if (!merchantNwc.readiness.ready) {
    await recordFeeStatus(paymentId, "FAILED", {
      reason: merchantNwc.readiness.reason || "Merchant NWC wallet is missing required live-payment permissions",
      missingPermissions: merchantNwc.readiness.missingPermissions
    })
    return {
      status: "FAILED",
      errorMessage: merchantNwc.readiness.reason || "Merchant NWC wallet is missing required live-payment permissions"
    }
  }

  await recordFeeStatus(paymentId, "PENDING")

  let feeAmountSats: number
  let btcPriceUsd: number

  try {
    const result = await getFeeAmountSats(PINETREE_FEE)
    feeAmountSats = result.feeAmountSats
    btcPriceUsd = result.btcPriceUsd
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "BTC price fetch failed"
    console.error("[nwc/fee] Failed to get BTC price for fee conversion", { paymentId, errorMessage })
    await recordFeeStatus(paymentId, "RETRY_REQUIRED", { reason: errorMessage })
    return { status: "RETRY_REQUIRED", errorMessage }
  }

  // Create a treasury invoice that the merchant NWC wallet will pay
  let treasuryInvoice: string

  try {
    const { makeNwcInvoice } = await import("@/providers/lightning/nwcClient")
    const feeAmountMsat = feeAmountSats * 1000
    const description = `PineTree platform fee — payment ${paymentId}`
    const invoiceResult = await makeNwcInvoice(treasuryNwcUri, feeAmountMsat, description, 600)
    if (!isExpectedFeeAmount(invoiceResult.amountMsat, feeAmountSats)) {
      throw new Error("Treasury invoice amount mismatch")
    }
    treasuryInvoice = invoiceResult.invoice
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Treasury invoice creation failed"
    console.error("[nwc/fee] Failed to create treasury invoice", { paymentId, errorMessage })
    await recordFeeStatus(paymentId, "RETRY_REQUIRED", { reason: errorMessage })
    return { status: "RETRY_REQUIRED", errorMessage }
  }

  // Ask the merchant's NWC wallet to pay the treasury invoice
  try {
    const payResult = await payNwcInvoice(merchantNwc.nwcUri, treasuryInvoice)

    console.info("[nwc/fee] Platform fee collected successfully", {
      paymentId,
      feeAmountSats,
      btcPriceUsd,
      merchantNwcMasked: maskNwcUri(merchantNwc.nwcUri),
      preimage: payResult.preimage.slice(0, 8) + "..."
    })

    await recordFeeStatus(paymentId, "PAID", {
      preimage: payResult.preimage,
      feeAmountSats,
      btcPriceUsd
    })

    try {
      await createLedgerEntry({
        payment_id: paymentId,
        merchant_id: merchantId,
        provider: "lightning_nwc",
        network: "bitcoin_lightning",
        asset: "BTC",
        amount: feeAmountSats,
        usd_value: PINETREE_FEE,
        direction: "platform_fee_out",
        status: "CONFIRMED"
      })
    } catch (err) {
      await recordFeeStatus(paymentId, "PAID", {
        feeAmountSats,
        btcPriceUsd,
        ledgerWarning: err instanceof Error ? err.message : "Fee ledger entry failed"
      })
    }

    return { status: "PAID", preimage: payResult.preimage, feeAmountSats }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Fee payment failed"
    console.error("[nwc/fee] Failed to collect platform fee", {
      paymentId,
      errorMessage,
      merchantNwcMasked: maskNwcUri(merchantNwc.nwcUri)
    })

    await recordFeeStatus(paymentId, "RETRY_REQUIRED", { reason: errorMessage })
    return { status: "RETRY_REQUIRED", errorMessage }
  }
}

// ─── Fee Status Recording ─────────────────────────────────────────────────────

async function recordFeeStatus(
  paymentId: string,
  status: NwcFeeStatus,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db.from("payment_events").insert({
      payment_id: paymentId,
      event_type: "nwc_fee_collection",
      event_data: {
        fee_status: status,
        ...(metadata || {})
      },
      created_at: new Date().toISOString()
    })
  } catch (err) {
    // Non-fatal: don't let event recording break the fee flow
    console.warn("[nwc/fee] Could not record fee status event", {
      paymentId,
      status,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

// ─── NWC Merchant Setup Helpers ───────────────────────────────────────────────

/**
 * Returns the merchant's NWC URI for use in the payment engine.
 * Called by createPayment when the lightning_nwc adapter is selected.
 *
 * Engine is the only layer that reads the NWC URI from the database.
 * The URI is never returned to the client.
 */
export async function getMerchantNwcUriForPayment(
  merchantId: string
): Promise<Awaited<ReturnType<typeof getMerchantNwcSetup>> | null> {
  const setup = await getMerchantNwcSetup(merchantId)
  if (!setup) return null

  return setup
}

