/**
 * Normalizes Speed connected-account webhook events into
 * merchant_wallet_operations rows for the merchant wallet Activity view.
 *
 * Called from app/api/webhooks/speed/route.ts AFTER processWebhook() has
 * already verified the webhook signature and handled PineTree's existing
 * payment.created/payment.paid settlement logic - this module is strictly
 * additive and must never affect that existing behavior. Every call is
 * wrapped in try/catch by the caller so a normalization failure can never
 * break the webhook's 200 acknowledgement.
 *
 * Only the webhook event names Speed's official documentation confirms
 * (apidocs.tryspeed.com/reference/types-of-events) are handled. Everything
 * else is recorded in speed_webhook_events for idempotency/diagnostics and
 * otherwise ignored - never guessed into a wallet operation.
 *
 * payment.paid/payment.confirmed create or update incoming activity.
 * withdraw.created/paid/failed may update an existing PineTree-initiated
 * Instant Send by its account-scoped reference IDs, but never create a new
 * authoritative withdrawal row on their own. Other events remain diagnostic.
 */

import { extractSpeedWebhookAccountId, isSpeedConnectedAccountWebhookPayload } from "@/providers/lightning/speedClient"
import { getMerchantIdBySpeedAccountId } from "@/database/merchantLightningProfiles"
import { claimSpeedWebhookEvent, markSpeedWebhookEventProcessed } from "@/database/speedWebhookEvents"
import {
  updateWalletOperationFromProviderEvent,
  upsertWalletOperationFromWebhook,
} from "@/database/merchantWalletOperations"

const WALLET_RELEVANT_PAYMENT_EVENTS = new Set(["payment.paid", "payment.confirmed"])
const WALLET_RELEVANT_WITHDRAW_EVENTS = new Set(["withdraw.created", "withdraw.paid", "withdraw.failed"])

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function getEventType(payload: unknown): string {
  return String(
    readPath(payload, ["event", "type"]) || readPath(payload, ["type"]) || readPath(payload, ["event_type"]) || ""
  ).trim()
}

function getPaymentReference(payload: unknown): string {
  return String(
    readPath(payload, ["data", "object", "id"]) || readPath(payload, ["data", "id"]) || readPath(payload, ["id"]) || ""
  ).trim()
}

function getPaymentTargetAmount(payload: unknown): { amount: bigint; asset: string } | null {
  const targetAmount = readPath(payload, ["data", "object", "target_amount"]) ?? readPath(payload, ["target_amount"])
  const targetCurrency =
    readPath(payload, ["data", "object", "target_currency"]) ?? readPath(payload, ["target_currency"]) ?? "SATS"
  const asset = String(targetCurrency || "SATS").trim().toUpperCase()
  const amountText = String(targetAmount ?? "").trim()
  // PineTree-created Speed payments settle to SATS. Reject any unexpected
  // asset/fraction instead of rounding a webhook amount into a ledger value.
  if (asset !== "SATS" || !/^\d+$/.test(amountText)) return null
  const amount = BigInt(amountText)
  return amount > BigInt(0) ? { amount, asset } : null
}

export type NormalizeWalletWebhookResult = {
  handled: boolean
  reason: string
}

export async function normalizeSpeedWebhookForWallet(
  payload: unknown,
  headers: Record<string, string | undefined>
): Promise<NormalizeWalletWebhookResult> {
  if (!isSpeedConnectedAccountWebhookPayload(payload)) {
    return { handled: false, reason: "not_connected_account_event" }
  }

  const providerEventId = String(headers["webhook-id"] || "").trim()
  if (!providerEventId) {
    return { handled: false, reason: "missing_webhook_id" }
  }

  const accountId = extractSpeedWebhookAccountId(payload)
  const merchantId = accountId ? await getMerchantIdBySpeedAccountId(accountId) : null
  const eventType = getEventType(payload)

  const claim = await claimSpeedWebhookEvent({
    providerEventId,
    eventType: eventType || "unknown",
    accountId,
    merchantId,
    rawPayload: null, // Payment payloads may carry customer-identifying metadata - never persisted raw for a merchant-visible flow. Diagnostics rely on eventType/accountId/merchantId above.
  })

  if (!claim.claimed) {
    return { handled: false, reason: "duplicate_event" }
  }

  if (!merchantId) {
    return { handled: false, reason: "merchant_not_matched" }
  }

  if (!WALLET_RELEVANT_PAYMENT_EVENTS.has(eventType)) {
    if (!WALLET_RELEVANT_WITHDRAW_EVENTS.has(eventType)) {
      return { handled: false, reason: "event_not_wallet_relevant" }
    }

    const object = (readPath(payload, ["data", "object"]) || readPath(payload, ["data"]) || payload) as Record<string, unknown>
    const withdrawId = String(object?.id || "").trim()
    const instantSendId = String(object?.reference_id || "").trim()
    if (!withdrawId || !instantSendId || String(object?.reference_type || "") !== "instant_send") {
      return { handled: false, reason: "withdraw_event_missing_reference" }
    }
    const status = eventType === "withdraw.paid"
      ? "COMPLETED" as const
      : eventType === "withdraw.failed"
        ? "FAILED" as const
        : "PENDING" as const
    const operation = await updateWalletOperationFromProviderEvent({
      merchantId,
      providerAccountId: accountId!,
      providerReference: instantSendId,
      providerSecondaryReference: withdrawId,
      status,
      providerStatus: eventType,
      failureReason: typeof object.failure_reason === "string" ? object.failure_reason.slice(0, 200) : null,
      txHash: typeof object.transaction_hash === "string" ? object.transaction_hash : null,
      completedAt: status === "COMPLETED" ? new Date().toISOString() : null,
    })
    if (!operation) return { handled: false, reason: "withdraw_operation_not_matched" }
    await markSpeedWebhookEventProcessed(claim.record.id, operation.id)
    return { handled: true, reason: "withdraw_operation_updated" }
  }

  const paymentReference = getPaymentReference(payload)
  const amount = getPaymentTargetAmount(payload)
  if (!paymentReference || !amount) {
    return { handled: false, reason: "payload_missing_amount_or_reference" }
  }

  const { operation } = await upsertWalletOperationFromWebhook({
    merchantId,
    providerAccountId: accountId!,
    operationType: "PAYMENT",
    direction: "credit",
    status: "COMPLETED",
    asset: amount.asset,
    amountBaseUnits: amount.amount,
    providerReference: paymentReference,
    providerStatus: eventType,
    idempotencyKey: `speed:payment:${paymentReference}`,
    completedAt: new Date().toISOString(),
  })

  await markSpeedWebhookEventProcessed(claim.record.id, operation.id)
  return { handled: true, reason: "wallet_operation_upserted" }
}
