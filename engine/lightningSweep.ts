/**
 * PineTree automatic Lightning sweep state machine.
 *
 * After a merchant receives a confirmed Lightning payment settled into their
 * Speed Custom Connect account balance (speed_connect_split mode - NOT
 * treasury-sweep mode, which never lands funds in a per-merchant Speed
 * sub-account), PineTree automatically transfers the eligible net SATS to a
 * fresh BOLT11 invoice from the same merchant's PineTree Wallet via Speed
 * Instant Send.
 *
 * Live Instant Send remains feature-flagged with
 * SPEED_LIGHTNING_SWEEP_ENABLED. Merchant identity is server-resolved and
 * every Speed call is scoped to the canonical connected account.
 */

import { getPaymentById } from "@/database/payments"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { SPEED_PROVIDER_NAME, getMerchantNwcSetup } from "@/database/merchantProviders"
import { isSpeedPlatformTreasurySweepEnabled } from "@/providers/lightning/speedClient"
import { lookupNwcInvoice } from "@/providers/lightning/nwcClient"
import {
  resolveSpeedHeaderAccountId,
  SpeedHeaderAccountIdUnresolvedError,
} from "@/providers/lightning/speedHeaderAccountResolver"
import {
  getConnectedAccountBalance,
  getInstantSendStatus,
  sendToLightningInvoice,
  SpeedInstantSendNotConfiguredError,
  SpeedInstantSendProviderError,
} from "@/providers/lightning/speedInstantSend"
import {
  createMerchantLightningSweepInvoice,
  PineTreeWalletLightningReceiveNotConfiguredError,
} from "@/engine/pineTreeWalletLightningInvoice"
import {
  claimLightningSweepForProcessing,
  createLightningSweepIfMissing,
  incrementLightningSweepAttempt,
  listProcessableLightningSweeps,
  updateLightningSweep,
  type MerchantLightningSweep,
} from "@/database/merchantLightningSweeps"

function positiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
  }
  return 0
}

/**
 * Mirrors the toSats helper already duplicated in engine/lightningPayouts.ts
 * and engine/lightningSettlement.ts - kept as a third, self-contained copy
 * rather than extracted into a shared util, matching this codebase's
 * existing convention for these small per-module settlement helpers.
 */
function toSats(input: {
  merchantNetUsd: number
  paymentMetadata: Record<string, unknown>
}): number {
  const explicit = positiveNumber(
    input.paymentMetadata.merchant_net_sats,
    (input.paymentMetadata.split as Record<string, unknown> | undefined)?.merchantNativeAmountAtomic
  )
  if (explicit > 0) return Math.round(explicit)

  const split = input.paymentMetadata.split as Record<string, unknown> | undefined
  const btcPriceUsd = positiveNumber(split?.quotePriceUsd, input.paymentMetadata.btcPriceUsd)
  if (btcPriceUsd <= 0) return 0
  return Math.round((input.merchantNetUsd / btcPriceUsd) * 100_000_000)
}

// ─── Configuration ──────────────────────────────────────────────────────────

function getSweepMinSats(): number {
  const configured = Number(process.env.SPEED_SWEEP_MIN_SATS || "")
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 1
}

function getSweepFeeReserveSats(): number {
  const configured = Number(process.env.SPEED_SWEEP_FEE_RESERVE_SATS || "")
  return Number.isFinite(configured) && configured >= 0 ? Math.round(configured) : 0
}

function getSweepMaxAttempts(): number {
  const configured = Number(process.env.SPEED_SWEEP_MAX_ATTEMPTS || "")
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 5
}

function getSweepRetryBaseSeconds(): number {
  const configured = Number(process.env.SPEED_SWEEP_RETRY_BASE_SECONDS || "")
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 30
}

const MAX_BACKOFF_SECONDS = 60 * 60 // 1 hour ceiling regardless of attempt count
const GAP_RETRY_SECONDS = 5 * 60 // how soon to re-check a configuration/balance gap
const CONFIRMATION_RECHECK_SECONDS = 30 // how soon to re-check an in-flight send

function backoffSeconds(attemptCount: number): number {
  const base = getSweepRetryBaseSeconds()
  const delay = base * Math.pow(2, Math.max(0, attemptCount - 1))
  return Math.min(MAX_BACKOFF_SECONDS, Math.round(delay))
}

function nextAttemptAtFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

// ─── Queueing (webhook trigger) ─────────────────────────────────────────────

export type EnsureLightningSweepResult = MerchantLightningSweep | null

/**
 * Idempotently queues a sweep for a confirmed Speed Lightning payment. Safe
 * to call repeatedly (duplicate webhook deliveries, concurrent callers) -
 * returns the existing sweep on any repeat call rather than creating a
 * second one. Returns null when there is nothing to sweep (wrong provider,
 * wrong rail, not confirmed, treasury-sweep mode, no active Custom Connect
 * account, or nothing eligible to sweep).
 */
export async function ensureLightningSweepForConfirmedPayment(input: {
  paymentId: string
}): Promise<EnsureLightningSweepResult> {
  const payment = await getPaymentById(input.paymentId)
  if (!payment) return null
  if (payment.provider !== SPEED_PROVIDER_NAME) return null
  if (String(payment.network || "").toLowerCase() !== "bitcoin_lightning") return null
  if (String(payment.status || "").toUpperCase() !== "CONFIRMED") return null

  // Treasury-sweep mode collects the whole payment into PineTree's own
  // platform Speed account - funds never land in a per-merchant Custom
  // Connect sub-account, so there is nothing to sweep out of.
  if (isSpeedPlatformTreasurySweepEnabled()) return null

  const lightningProfile = await getMerchantLightningProfile(payment.merchant_id)
  const speedConnectedAccountId = String(lightningProfile?.speed_account_id || "").trim()
  if (!speedConnectedAccountId) return null

  const paymentMetadata = (payment.metadata || {}) as Record<string, unknown>
  const split = (paymentMetadata.split || {}) as Record<string, unknown>
  const merchantNetUsd = positiveNumber(split.merchantNativeAmount, payment.merchant_amount)
  const merchantNetSats = toSats({ merchantNetUsd, paymentMetadata })

  const minSats = getSweepMinSats()
  if (merchantNetSats < minSats) return null

  return createLightningSweepIfMissing({
    merchantId: payment.merchant_id,
    sourcePaymentId: payment.id,
    speedConnectedAccountId,
    requestedAmountSats: merchantNetSats,
    feeReserveSats: getSweepFeeReserveSats(),
    status: "queued",
  })
}

// ─── Processing ──────────────────────────────────────────────────────────────

type SweepStepOutcome =
  | "skipped"
  | "awaiting_configuration"
  | "awaiting_balance"
  | "awaiting_invoice"
  | "sent"
  | "confirmed"
  | "still_processing"
  | "retry_scheduled"
  | "failed"

export type LightningSweepProcessingSummary = {
  scanned: number
  processed: number
  outcomes: Record<string, number>
}

/**
 * Advances a single sweep by exactly one step (never issues two send
 * attempts for the same sweep - the claim is a compare-and-set that only
 * one concurrent caller can win). Configuration gaps (Speed endpoint not
 * confirmed, header account id unresolved, no PineTree Wallet Lightning
 * receive capability, insufficient balance) never consume an attempt - only
 * an actual Speed Instant Send call does.
 */
export async function processOneLightningSweep(sweepId: string): Promise<SweepStepOutcome> {
  const claimed = await claimLightningSweepForProcessing(sweepId)
  if (!claimed) return "skipped"

  try {
    // Already sent - check for confirmation instead of sending again.
    if (claimed.provider_send_id) {
      return await recheckSweepConfirmation(claimed)
    }

    const lightningProfile = await getMerchantLightningProfile(claimed.merchant_id)
    let speedHeaderAccountId: string
    try {
      speedHeaderAccountId = resolveSpeedHeaderAccountId({
        merchant_id: claimed.merchant_id,
        speed_account_id: lightningProfile?.speed_account_id ?? null,
        speed_header_account_id: lightningProfile?.speed_header_account_id ?? null,
      })
    } catch (error) {
      if (error instanceof SpeedHeaderAccountIdUnresolvedError) {
        await updateLightningSweep(claimed.id, {
          status: "awaiting_configuration",
          lastErrorCode: `header_account_id_${error.reason}`,
          lastErrorMessage: error.message,
          nextAttemptAt: nextAttemptAtFromNow(GAP_RETRY_SECONDS),
        })
        return "awaiting_configuration"
      }
      throw error
    }

    // Reuse a still-valid invoice; a retry after expiry must always mint a
    // fresh one rather than resend to a dead BOLT11 invoice.
    let invoice = claimed.destination_invoice
    const invoiceStillValid =
      invoice && claimed.destination_invoice_expires_at
        ? new Date(claimed.destination_invoice_expires_at).getTime() > Date.now()
        : false

    if (!invoiceStillValid) {
      const netOfReserve = claimed.requested_amount_sats - claimed.fee_reserve_sats
      if (netOfReserve <= 0) {
        await updateLightningSweep(claimed.id, {
          status: "failed",
          lastErrorCode: "fee_reserve_exceeds_amount",
          lastErrorMessage: "Configured fee reserve leaves nothing to sweep.",
        })
        return "failed"
      }

      try {
        const created = await createMerchantLightningSweepInvoice({
          merchantId: claimed.merchant_id,
          amountSats: netOfReserve,
          sweepId: claimed.id,
        })
        invoice = created.invoice
        await updateLightningSweep(claimed.id, {
          status: "invoice_created",
          destinationInvoice: created.invoice,
          destinationInvoiceHash: created.paymentHash,
          destinationInvoiceExpiresAt: created.expiresAt,
          destinationWalletProfileId: created.destinationWalletProfileId,
          lastErrorCode: null,
          lastErrorMessage: null,
        })
      } catch (error) {
        if (error instanceof PineTreeWalletLightningReceiveNotConfiguredError) {
          await updateLightningSweep(claimed.id, {
            status: "awaiting_invoice",
            lastErrorCode: "pinetree_wallet_lightning_receive_not_configured",
            lastErrorMessage: error.message,
            nextAttemptAt: nextAttemptAtFromNow(GAP_RETRY_SECONDS),
          })
          return "awaiting_invoice"
        }
        throw error
      }
    }

    // Balance check - never assume the webhook's gross amount equals the
    // withdrawable balance, and never send more than what Speed reports as
    // available right now.
    let availableSats: number
    try {
      const balance = await getConnectedAccountBalance({
        speedHeaderAccountId,
        merchantId: claimed.merchant_id,
      })
      availableSats = balance.availableSats
    } catch (error) {
      if (error instanceof SpeedInstantSendNotConfiguredError) {
        await updateLightningSweep(claimed.id, {
          status: "awaiting_configuration",
          speedHeaderAccountId,
          lastErrorCode: error.reason,
          lastErrorMessage: error.message,
          nextAttemptAt: nextAttemptAtFromNow(GAP_RETRY_SECONDS),
        })
        return "awaiting_configuration"
      }
      throw error
    }

    const netOfReserve = claimed.requested_amount_sats - claimed.fee_reserve_sats
    const sendAmountSats = Math.min(netOfReserve, availableSats)
    if (sendAmountSats <= 0) {
      await updateLightningSweep(claimed.id, {
        status: "awaiting_balance",
        speedHeaderAccountId,
        lastErrorCode: "insufficient_available_balance",
        lastErrorMessage: `Available balance ${availableSats} sats is insufficient for a ${netOfReserve} sat sweep.`,
        nextAttemptAt: nextAttemptAtFromNow(GAP_RETRY_SECONDS),
      })
      return "awaiting_balance"
    }

    // From here on, a real Speed Instant Send call is about to be attempted -
    // this is the only point in the state machine that consumes an attempt.
    await incrementLightningSweepAttempt(claimed.id)

    try {
      const result = await sendToLightningInvoice({
        speedHeaderAccountId,
        invoice: String(invoice),
        amountSats: sendAmountSats,
        idempotencyKey: claimed.idempotency_key,
        merchantId: claimed.merchant_id,
      })

      await updateLightningSweep(claimed.id, {
        status: "processing",
        speedHeaderAccountId,
        sentAmountSats: sendAmountSats,
        providerSendId: result.providerSendId,
        providerStatus: result.providerStatus,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextAttemptAt: nextAttemptAtFromNow(CONFIRMATION_RECHECK_SECONDS),
      })
      return "sent"
    } catch (error) {
      return await handleSendFailure(claimed, error)
    }
  } catch (error) {
    // Any unexpected/unclassified error - never leave the sweep stuck in
    // "processing" with no diagnostic trail.
    const message = error instanceof Error ? error.message : String(error)
    await updateLightningSweep(sweepId, {
      status: "retryable_failed",
      lastErrorCode: "unexpected_error",
      lastErrorMessage: message,
      nextAttemptAt: nextAttemptAtFromNow(backoffSeconds(claimed.attempt_count + 1)),
    })
    return "retry_scheduled"
  }
}

async function handleSendFailure(
  sweep: MerchantLightningSweep,
  error: unknown
): Promise<SweepStepOutcome> {
  if (error instanceof SpeedInstantSendNotConfiguredError) {
    // Rare TOCTOU race: configuration/flag changed between the balance
    // check and the send call. This attempt was already counted; treat it
    // as a configuration gap so the sweep waits rather than exhausting
    // retries against a condition that isn't the provider's fault.
    await updateLightningSweep(sweep.id, {
      status: "awaiting_configuration",
      lastErrorCode: error.reason,
      lastErrorMessage: error.message,
      nextAttemptAt: nextAttemptAtFromNow(GAP_RETRY_SECONDS),
    })
    return "awaiting_configuration"
  }

  const attemptCount = sweep.attempt_count + 1 // incrementLightningSweepAttempt already ran
  const maxAttempts = getSweepMaxAttempts()

  if (error instanceof SpeedInstantSendProviderError && !error.retryable) {
    await updateLightningSweep(sweep.id, {
      status: "failed",
      lastErrorCode: error.providerCode || "deterministic_rejection",
      lastErrorMessage: error.message,
    })
    return "failed"
  }

  const message = error instanceof Error ? error.message : String(error)
  const errorCode =
    error instanceof SpeedInstantSendProviderError
      ? error.providerCode || String(error.httpStatus || "transient")
      : "unknown_send_error"

  if (attemptCount >= maxAttempts) {
    await updateLightningSweep(sweep.id, {
      status: "failed",
      lastErrorCode: errorCode,
      lastErrorMessage: `${message} (exhausted ${attemptCount}/${maxAttempts} attempts)`,
    })
    return "failed"
  }

  await updateLightningSweep(sweep.id, {
    status: "retryable_failed",
    lastErrorCode: errorCode,
    lastErrorMessage: message,
    nextAttemptAt: nextAttemptAtFromNow(backoffSeconds(attemptCount)),
  })
  return "retry_scheduled"
}

/**
 * A sweep already has a provider_send_id - confirm it rather than sending
 * again. Confirmation accepts either a confirmed provider result (once
 * Speed's status contract is implemented) or a verified destination-wallet
 * receipt (an NWC lookup_invoice showing the invoice settled) - either is
 * sufficient, matching this feature's "require a confirmed provider result
 * or a verified destination-wallet receipt" requirement.
 */
async function recheckSweepConfirmation(sweep: MerchantLightningSweep): Promise<SweepStepOutcome> {
  if (sweep.provider_send_id && sweep.speed_header_account_id) {
    try {
      const provider = await getInstantSendStatus({
        speedHeaderAccountId: sweep.speed_header_account_id,
        providerSendId: sweep.provider_send_id,
        merchantId: sweep.merchant_id,
      })
      const status = provider.providerStatus.trim().toLowerCase()
      if (status === "paid") {
        await updateLightningSweep(sweep.id, {
          status: "confirmed",
          providerStatus: provider.providerStatus,
          completedAt: new Date().toISOString(),
          lastErrorCode: null,
          lastErrorMessage: null,
        })
        return "confirmed"
      }
      if (status === "failed") {
        await updateLightningSweep(sweep.id, {
          status: "failed",
          providerStatus: provider.providerStatus,
          lastErrorCode: "provider_send_failed",
          lastErrorMessage: "Speed reported that the Instant Send failed.",
        })
        return "failed"
      }
    } catch (error) {
      console.warn("[lightning-sweep] provider status lookup failed", {
        sweepId: sweep.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (sweep.destination_invoice_hash) {
    const nwc = await getMerchantNwcSetup(sweep.merchant_id)
    if (nwc) {
      try {
        const status = await lookupNwcInvoice(nwc.nwcUri, sweep.destination_invoice_hash)
        if (status.settled) {
          await updateLightningSweep(sweep.id, {
            status: "confirmed",
            completedAt: new Date().toISOString(),
            lastErrorCode: null,
            lastErrorMessage: null,
          })
          return "confirmed"
        }
      } catch (error) {
        // A lookup failure is not itself a send failure - leave the sweep in
        // processing and re-check on the next bounded pass.
        console.warn("[lightning-sweep] destination invoice lookup failed", {
          sweepId: sweep.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  await updateLightningSweep(sweep.id, {
    nextAttemptAt: nextAttemptAtFromNow(CONFIRMATION_RECHECK_SECONDS),
  })
  return "still_processing"
}

/**
 * Bounded batch pass - safe to call from a webhook's after() callback, a
 * merchant wallet page load, or an admin reconciliation action. Never
 * unbounded, never client-polled.
 */
export async function processQueuedLightningSweeps(
  options: { limit?: number } = {}
): Promise<LightningSweepProcessingSummary> {
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20))
  const sweeps = await listProcessableLightningSweeps(limit)

  const summary: LightningSweepProcessingSummary = {
    scanned: sweeps.length,
    processed: 0,
    outcomes: {},
  }

  for (const sweep of sweeps) {
    const outcome = await processOneLightningSweep(sweep.id)
    if (outcome !== "skipped") summary.processed += 1
    summary.outcomes[outcome] = (summary.outcomes[outcome] || 0) + 1
  }

  return summary
}
