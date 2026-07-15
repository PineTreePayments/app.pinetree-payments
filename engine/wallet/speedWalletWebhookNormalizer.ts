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
 * Scope note: only payment.paid / payment.confirmed are normalized into a
 * wallet operation today. withdraw.*, withdraw_request.*, and
 * connect.completed events are stored for idempotency + diagnostics only,
 * because PineTree
 * cannot yet create a connected-account withdrawal/payout itself (see
 * providers/lightning/speedWalletManagement.ts) - a webhook confirming a
 * withdrawal PineTree never initiated is a signal worth keeping, not one
 * this module should turn into an authoritative ledger row on its own.
 */

import { extractSpeedWebhookAccountId, isSpeedConnectedAccountWebhookPayload } from "@/providers/lightning/speedClient"
import { getMerchantIdBySpeedAccountId } from "@/database/merchantLightningProfiles"
import { claimSpeedWebhookEvent, markSpeedWebhookEventProcessed } from "@/database/speedWebhookEvents"
import { upsertWalletOperationFromWebhook } from "@/database/merchantWalletOperations"

const WALLET_RELEVANT_PAYMENT_EVENTS = new Set(["payment.paid", "payment.confirmed"])

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
  const amountNumber = Number(targetAmount)
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) return null
  return { amount: BigInt(Math.round(amountNumber)), asset: String(targetCurrency || "SATS").trim().toUpperCase() }
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
    return { handled: false, reason: "event_not_wallet_relevant" }
  }

  const paymentReference = getPaymentReference(payload)
  const amount = getPaymentTargetAmount(payload)
  if (!paymentReference || !amount) {
    return { handled: false, reason: "payload_missing_amount_or_reference" }
  }

  const { operation } = await upsertWalletOperationFromWebhook({
    merchantId,
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
