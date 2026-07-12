/**
 * Internal-only PineTree administrative access to Lightning sweep state.
 * Every export here must only ever be called after requireAdminFromRequest
 * has resolved - see app/api/admin/lightning-sweeps/*.
 *
 * Never import this module from a merchant-facing route or the PineTree
 * Wallet page. Merchants only ever see PineTree-branded transfer status -
 * never a Speed account id, a raw provider payload, or this sweep's
 * internal identifiers.
 */

import {
  getLightningSweepById,
  listLightningSweepsForAdmin,
  listLightningSweepsForMerchant,
  updateLightningSweep,
  LIGHTNING_SWEEP_TERMINAL_STATUSES,
  type MerchantLightningSweep,
  type MerchantLightningSweepStatus,
} from "@/database/merchantLightningSweeps"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"

type StatusError = Error & { status?: number }

function statusError(message: string, status: number): StatusError {
  const error = new Error(message) as StatusError
  error.status = status
  return error
}

// Non-secret summary - safe for an admin list/detail view. Deliberately
// excludes the raw BOLT11 invoice, invoice hash, resolved X-Speed-Account
// header value, and raw provider_status payload - none of those are on the
// explicit admin-visibility list and there is no operational need to widen
// exposure beyond it.
export type AdminLightningSweepSummary = {
  id: string
  merchantId: string
  sourcePaymentId: string
  speedConnectedAccountId: string
  requestedAmountSats: number
  feeReserveSats: number
  sentAmountSats: number | null
  status: MerchantLightningSweepStatus
  attemptCount: number
  nextAttemptAt: string | null
  providerSendId: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

function toSummary(sweep: MerchantLightningSweep): AdminLightningSweepSummary {
  return {
    id: sweep.id,
    merchantId: sweep.merchant_id,
    sourcePaymentId: sweep.source_payment_id,
    speedConnectedAccountId: sweep.speed_connected_account_id,
    requestedAmountSats: sweep.requested_amount_sats,
    feeReserveSats: sweep.fee_reserve_sats,
    sentAmountSats: sweep.sent_amount_sats,
    status: sweep.status,
    attemptCount: sweep.attempt_count,
    nextAttemptAt: sweep.next_attempt_at,
    providerSendId: sweep.provider_send_id,
    lastErrorCode: sweep.last_error_code,
    lastErrorMessage: sweep.last_error_message,
    createdAt: sweep.created_at,
    updatedAt: sweep.updated_at,
    completedAt: sweep.completed_at,
  }
}

export async function getAdminLightningSweeps(input: {
  merchantId?: string
  limit?: number
}): Promise<AdminLightningSweepSummary[]> {
  const sweeps = input.merchantId
    ? await listLightningSweepsForMerchant(input.merchantId, input.limit ?? 25)
    : await listLightningSweepsForAdmin(input.limit ?? 50)
  return sweeps.map(toSummary)
}

export async function getAdminLightningSweepById(sweepId: string): Promise<AdminLightningSweepSummary> {
  const sweep = await getLightningSweepById(sweepId)
  if (!sweep) throw statusError("Lightning sweep not found", 404)
  return toSummary(sweep)
}

/**
 * Requeues a stuck sweep for another processing pass. Allowed from any
 * non-confirmed status, including the terminal `failed` status (an admin
 * explicitly asking to try again is a deliberate override of the automatic
 * retry-exhaustion decision) - but never from `confirmed` (already settled)
 * or an in-flight `processing`/`sending` state (would risk a duplicate send;
 * let the existing claim/confirmation-recheck cycle finish first).
 */
export async function retryAdminLightningSweep(input: {
  sweepId: string
  adminId: string
}): Promise<AdminLightningSweepSummary> {
  const sweep = await getLightningSweepById(input.sweepId)
  if (!sweep) throw statusError("Lightning sweep not found", 404)

  if (sweep.status === "confirmed") {
    throw statusError("Cannot retry a confirmed sweep.", 409)
  }
  if (sweep.status === "processing" || sweep.status === "sending") {
    throw statusError("Cannot retry a sweep that is currently being processed.", 409)
  }

  const updated = await updateLightningSweep(sweep.id, {
    status: "queued",
    nextAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  })

  await insertMerchantAuditEvent({
    merchantId: sweep.merchant_id,
    eventType: "lightning.sweep_retried",
    actorId: input.adminId,
    metadata: { sweep_id: sweep.id, previous_status: sweep.status },
  })

  return toSummary(updated)
}

/**
 * Cancels a sweep before it has ever been sent to Speed. Never cancels a
 * sweep that already has a provider_send_id - once a send has been
 * attempted, cancellation could race a real in-flight transfer.
 */
export async function cancelAdminLightningSweep(input: {
  sweepId: string
  adminId: string
}): Promise<AdminLightningSweepSummary> {
  const sweep = await getLightningSweepById(input.sweepId)
  if (!sweep) throw statusError("Lightning sweep not found", 404)

  if (LIGHTNING_SWEEP_TERMINAL_STATUSES.has(sweep.status)) {
    throw statusError(`Cannot cancel a sweep already in terminal status "${sweep.status}".`, 409)
  }
  if (sweep.provider_send_id) {
    throw statusError("Cannot cancel a sweep that has already been sent to the provider.", 409)
  }

  const updated = await updateLightningSweep(sweep.id, { status: "canceled" })

  await insertMerchantAuditEvent({
    merchantId: sweep.merchant_id,
    eventType: "lightning.sweep_canceled",
    actorId: input.adminId,
    metadata: { sweep_id: sweep.id, previous_status: sweep.status },
  })

  return toSummary(updated)
}
