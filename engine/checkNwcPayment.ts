/**
 * PineTree — NWC Invoice Status Checker
 *
 * Single-execution check of a Bitcoin Lightning invoice via the NWC protocol.
 * Called by runPaymentWatcher for payments on the lightning_nwc adapter.
 *
 * Architecture placement:
 *   cron → runPaymentWatcher → checkNwcPaymentOnce → processPaymentEvent → updatePaymentStatus → DB
 *
 * Rules enforced here:
 *   - Only engine code calls this (never UI, API, or providers).
 *   - State transitions route through the canonical processPaymentEvent path.
 *   - Expired invoices route through updatePaymentStatus directly (INCOMPLETE is not a WatcherEvent type).
 *   - Fee collection fires AFTER confirmation and is non-fatal to the customer payment.
 */

import { getPaymentById } from "@/database"
import { getMerchantNwcSetup } from "@/database/merchantProviders"
import { supabaseAdmin, supabase } from "@/database"
import { lookupNwcInvoice } from "@/providers/lightning/nwcClient"
import { processPaymentEvent } from "./eventProcessor"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { collectNwcPlatformFee } from "./lightningNwc"
import { normalizeToStrictPaymentStatus } from "./paymentStateMachine"

const db = supabaseAdmin || supabase

/**
 * Check a single NWC Lightning payment's invoice status via NWC lookup_invoice.
 *
 * Returns true  if the invoice is settled and CONFIRMED was emitted.
 * Returns false if the invoice is not yet settled, or on any recoverable error.
 * Never throws.
 */
export async function checkNwcPaymentOnce(paymentId: string): Promise<boolean> {
  let payment: Awaited<ReturnType<typeof getPaymentById>>

  try {
    payment = await getPaymentById(paymentId)
  } catch (err) {
    console.error("[nwc/check] Failed to load payment", {
      paymentId,
      error: err instanceof Error ? err.message : String(err)
    })
    return false
  }

  if (!payment) {
    console.warn("[nwc/check] Payment not found", { paymentId })
    return false
  }

  const currentStatus = normalizeToStrictPaymentStatus(payment.status)
  const TERMINAL = new Set<string>(["CONFIRMED", "FAILED", "INCOMPLETE"])
  if (TERMINAL.has(currentStatus)) return false

  const meta = payment.metadata as {
    split?: {
      lightningPaymentHash?: string
      lightningExpiresAt?: string
    }
  } | null

  const paymentHash = String(meta?.split?.lightningPaymentHash || "").trim()
  if (!paymentHash) {
    console.warn("[nwc/check] No lightningPaymentHash in payment metadata — cannot check NWC invoice", { paymentId })
    return false
  }

  // If the invoice window has elapsed, advance to INCOMPLETE (PENDING → INCOMPLETE is valid).
  // This prevents the cron from retrying expired invoices indefinitely.
  const expiresAt = String(meta?.split?.lightningExpiresAt || "").trim()
  if (expiresAt) {
    const expiresAtMs = new Date(expiresAt).getTime()
    if (Number.isFinite(expiresAtMs) && expiresAtMs > 0 && Date.now() > expiresAtMs) {
      console.info("[nwc/check] Invoice expired — advancing to INCOMPLETE", { paymentId, expiresAt })
      try {
        await updatePaymentStatus(paymentId, "INCOMPLETE", {
          providerEvent: "nwc_invoice_expired",
          rawPayload: { paymentHash, expiresAt }
        })
      } catch (err) {
        console.warn("[nwc/check] Could not advance expired invoice to INCOMPLETE", {
          paymentId,
          error: err instanceof Error ? err.message : String(err)
        })
      }
      return false
    }
  }

  const merchantNwc = await getMerchantNwcSetup(payment.merchant_id)
  if (!merchantNwc) {
    console.warn("[nwc/check] Merchant NWC setup not found — skipping check", {
      paymentId,
      merchantId: payment.merchant_id
    })
    return false
  }

  // Record the status check attempt for audit visibility.
  try {
    await db.from("payment_events").insert({
      payment_id: paymentId,
      event_type: "nwc_invoice_check",
      event_data: { paymentHash, checkedAt: new Date().toISOString() }
    })
  } catch {
    // Non-fatal — never let audit logging block the check path.
  }

  let settled = false
  try {
    const invoiceStatus = await lookupNwcInvoice(merchantNwc.nwcUri, paymentHash)
    settled = invoiceStatus.settled
  } catch (err) {
    console.warn("[nwc/check] lookupNwcInvoice failed", {
      paymentId,
      error: err instanceof Error ? err.message : String(err)
    })
    return false
  }

  if (!settled) return false

  console.info("[nwc/check] Invoice settled — advancing to CONFIRMED", { paymentId, paymentHash })

  try {
    // feeCaptureValidated: true tells the event processor to skip split-wallet
    // verification — for NWC, fee collection happens post-payment, not at payment time.
    await processPaymentEvent({
      type: "payment.confirmed",
      paymentId,
      feeCaptureValidated: true
    })
  } catch (err) {
    console.error("[nwc/check] Failed to advance payment to CONFIRMED", {
      paymentId,
      error: err instanceof Error ? err.message : String(err)
    })
    return false
  }

  // Fee collection fires after the customer payment is CONFIRMED.
  // Failure here must never reverse or block the CONFIRMED status.
  const merchantId = payment.merchant_id
  void (async () => {
    try {
      await collectNwcPlatformFee(paymentId, merchantId)
    } catch (err) {
      console.error("[nwc/check] Unexpected error in collectNwcPlatformFee", {
        paymentId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  })()

  return true
}
