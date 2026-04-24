/**
 * PineTree Event Processor
 *
 * Canonical engine contract for provider webhook event handling:
 * verifyWebhook() -> translateEvent() -> engine/eventProcessor -> DB updates/events
 */

import { getProvider } from "./providerRegistry"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { getPaymentById, getPaymentByProviderReference, createPaymentEvent, upsertLedgerEntry } from "@/database"
import { PaymentStatus, normalizeToStrictPaymentStatus } from "./paymentStateMachine"
import {
  getTransactionByPaymentId,
  getTransactionByProviderReference,
  updateTransactionProviderReference,
  updateTransactionStatus,
  type TransactionStatus
} from "@/database/transactions"

export type WebhookInput = {
  provider: string
  payload: unknown
  headers?: Record<string, string>
  rawBody?: string
}

type TranslatedEvent = {
  paymentId?: string
  event:
    | "payment.created"
    | "payment.pending"
    | "payment.processing"
    | "payment.confirmed"
    | "payment.failed"
}

const eventToStatus: Record<TranslatedEvent["event"], PaymentStatus> = {
  "payment.created": "CREATED",
  "payment.pending": "PENDING",
  "payment.processing": "PROCESSING",
  "payment.confirmed": "CONFIRMED",
  "payment.failed": "FAILED"
}

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function getProviderEventType(payload: unknown): string {
  return String(
    readPath(payload, ["event", "type"]) ||
      readPath(payload, ["type"]) ||
      readPath(payload, ["event_type"]) ||
      readPath(payload, ["status"]) ||
      ""
  )
}

function getProviderReferenceCandidates(payload: unknown): string[] {
  const candidates = [
    readPath(payload, ["event", "data", "id"]),
    readPath(payload, ["data", "id"]),
    readPath(payload, ["payment", "id"]),
    readPath(payload, ["id"]),
    readPath(payload, ["charge_id"]),
    readPath(payload, ["reference"]),
    readPath(payload, ["providerReference"]),
    readPath(payload, ["provider_reference"])
  ]

  return [...new Set(candidates.map((value) => String(value || "").trim()).filter(Boolean))]
}

async function resolvePaymentIdFromEvent(input: {
  translatedEvent: TranslatedEvent | null
  payload: unknown
  provider: string
}) {
  const translatedPaymentId = String(input.translatedEvent?.paymentId || "").trim()
  if (translatedPaymentId) {
    return {
      paymentId: translatedPaymentId,
      source: "translated_event"
    }
  }

  const references = getProviderReferenceCandidates(input.payload)
  for (const reference of references) {
    const payment = await getPaymentByProviderReference(reference)
    if (payment) {
      console.info("[eventProcessor] resolved payment by provider reference", {
        provider: input.provider,
        providerReference: reference,
        paymentId: payment.id
      })
      return {
        paymentId: payment.id,
        source: "provider_reference"
      }
    }
  }

  return null
}

async function advancePaymentToTargetStatus(
  paymentId: string,
  targetStatus: PaymentStatus,
  metadata: { providerEvent?: string; rawPayload?: unknown }
) {
  const payment = await getPaymentById(paymentId)
  if (!payment) {
    throw new Error("Payment not found")
  }

  const currentStatus = normalizeToStrictPaymentStatus(payment.status)
  const split = (payment.metadata as { split?: Record<string, unknown> } | null)?.split
  const feeCaptureMethod = String(split?.feeCaptureMethod || "").trim().toLowerCase()
  const resolvedMetadata =
    targetStatus === "CONFIRMED"
      ? {
          ...metadata,
          rawPayload: {
            ...(metadata.rawPayload && typeof metadata.rawPayload === "object"
              ? metadata.rawPayload as Record<string, unknown>
              : {}),
            feeCaptureValidated:
              feeCaptureMethod === "invoice_split" ||
              feeCaptureMethod === "collection_then_settle" ||
              Boolean(
                (metadata.rawPayload as { feeCaptureValidated?: boolean } | undefined)?.feeCaptureValidated
              )
          }
        }
      : metadata

  if (currentStatus === targetStatus) {
    return
  }

  // For PROCESSING, step through CREATED → PENDING → PROCESSING as the state machine requires.
  if (targetStatus === "PROCESSING") {
    if (currentStatus === "CREATED") {
      await updatePaymentStatus(paymentId, "PENDING", resolvedMetadata)
      await updatePaymentStatus(paymentId, "PROCESSING", resolvedMetadata)
      return
    }
    if (currentStatus === "PENDING") {
      await updatePaymentStatus(paymentId, "PROCESSING", resolvedMetadata)
      return
    }
    // currentStatus === "PROCESSING" is caught by the early-return above — no-op.
    return
  }

  // For CONFIRMED, advance through all required lifecycle states.
  if (targetStatus === "CONFIRMED") {
    const transitions: PaymentStatus[] = []

    if (currentStatus === "CREATED") {
      transitions.push("PENDING", "PROCESSING", "CONFIRMED")
    } else if (currentStatus === "PENDING") {
      transitions.push("PROCESSING", "CONFIRMED")
    } else if (currentStatus === "PROCESSING") {
      transitions.push("CONFIRMED")
    }

    if (transitions.length) {
      for (const next of transitions) {
        await updatePaymentStatus(paymentId, next, resolvedMetadata)
      }
      return
    }
  }

  await updatePaymentStatus(paymentId, targetStatus, resolvedMetadata)
}

function toTransactionStatus(status: PaymentStatus): TransactionStatus {
  if (status === "CONFIRMED") return "CONFIRMED"
  if (status === "PROCESSING") return "PROCESSING"
  if (status === "FAILED") return "FAILED"
  if (status === "INCOMPLETE") return "EXPIRED"
  return "PENDING"
}

export async function processWebhook({
  provider,
  payload,
  headers,
  rawBody
}: WebhookInput) {
  const adapter = getProvider(provider)

  if (!adapter) {
    throw new Error(`Unknown provider: ${provider}`)
  }

  const signature =
    headers?.["x-cc-webhook-signature"] ||
    headers?.["x-signature"] ||
    headers?.["x-shift4-signature"] ||
    ""

  let verified = true

  if (adapter.verifyWebhook) {
    verified = adapter.verifyWebhook(payload, signature, rawBody)
  }

  if (!verified) {
    throw new Error("Webhook verification failed")
  }

  let event: TranslatedEvent | null = null

  if (adapter.translateEvent) {
    event = adapter.translateEvent(payload) as TranslatedEvent | null
  }

  if (!event) {
    console.warn("Could not translate webhook event:", payload)
    return
  }

  const resolution = await resolvePaymentIdFromEvent({
    translatedEvent: event,
    payload,
    provider
  })

  if (!resolution?.paymentId) {
    console.warn("Could not resolve payment id from webhook", {
      provider,
      providerEvent: getProviderEventType(payload)
    })
    return
  }

  const paymentId = resolution.paymentId
  const providerReferences = getProviderReferenceCandidates(payload)
  const status = eventToStatus[event.event]

  const payment = await getPaymentById(paymentId)
  if (!payment) {
    console.warn("Payment not found for webhook:", paymentId)
    return
  }

  // Idempotency guard — if the payment is already in a terminal state, a duplicate
  // webhook has arrived. Log and return without writing anything to the database.
  const TERMINAL_STATES = new Set<string>(["CONFIRMED", "FAILED", "INCOMPLETE"])
  const currentStatus = normalizeToStrictPaymentStatus(payment.status)
  if (TERMINAL_STATES.has(currentStatus)) {
    console.info("[eventProcessor] idempotent:terminal_state_skip", {
      provider,
      paymentId,
      currentStatus,
      incomingEvent: event.event
    })
    return
  }

  const transactionByPayment = await getTransactionByPaymentId(paymentId)
  let transaction = transactionByPayment

  if (!transaction) {
    for (const reference of providerReferences) {
      const byReference = await getTransactionByProviderReference(reference)
      if (byReference) {
        transaction = byReference
        break
      }
    }
  }

  if (transaction && !transaction.provider_transaction_id) {
    const providerReference = providerReferences[0]
    if (providerReference) {
      await updateTransactionProviderReference(transaction.id, providerReference)
      console.info("[eventProcessor] transaction provider reference linked", {
        provider,
        paymentId,
        transactionId: transaction.id,
        providerReference
      })
    }
  }

  const eventId = crypto.randomUUID()

  await createPaymentEvent({
    id: eventId,
    payment_id: paymentId,
    event_type: event.event,
    provider_event: getProviderEventType(payload),
    raw_payload: payload
  })

  try {
    await advancePaymentToTargetStatus(paymentId, status, {
      providerEvent: getProviderEventType(payload),
      rawPayload: payload
    })

    if (transaction) {
      await updateTransactionStatus(transaction.id, toTransactionStatus(status))
    }

    // Write ledger entry after the state machine succeeds — upsert is safe to call
    // from both the webhook and watcher paths; the unique DB constraint on payment_id
    // ensures only the first write wins.
    if (event.event === "payment.confirmed") {
      await upsertLedgerEntry({
        merchant_id: payment.merchant_id,
        payment_id: paymentId,
        transaction_id: transaction?.id,
        provider,
        network: payment.network,
        asset: payment.currency,
        amount: payment.gross_amount,
        usd_value: payment.gross_amount,
        wallet_address: payment.payment_url,
        direction: "INBOUND",
        status: "CONFIRMED"
      })
    }

    console.info("[eventProcessor] status applied", {
      provider,
      paymentId,
      targetStatus: status,
      event: event.event,
      resolutionSource: resolution.source,
      transactionId: transaction?.id || null
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes("Invalid payment transition")) {
      console.warn("Ignoring invalid transition:", {
        paymentId,
        message,
        targetStatus: status,
        provider
      })
    } else {
      throw error
    }
  }

}

// ─── Watcher event ───────────────────────────────────────────────────────────

export type WatcherEvent = {
  type: "payment.processing" | "payment.confirmed" | "payment.failed"
  paymentId: string
  txHash?: string
  value?: string
  from?: string
  feeCaptureValidated?: boolean
}

const watcherEventToStatus: Record<WatcherEvent["type"], PaymentStatus> = {
  "payment.processing": "PROCESSING",
  "payment.confirmed": "CONFIRMED",
  "payment.failed": "FAILED"
}

// ─── Watcher confirmation validator ──────────────────────────────────────────

type PaymentSplitMeta = {
  feeCaptureMethod?: string
  expectedAmountNative?: number
  merchantWallet?: string
  pinetreeWallet?: string
  merchantNativeAmountAtomic?: string | number
  feeNativeAmountAtomic?: string | number
  expectedMerchantAtomic?: string | number
  expectedFeeAtomic?: string | number
}

/**
 * Validates a watcher-detected transaction before allowing CONFIRMED advancement.
 * Called only when feeCaptureValidated is false (i.e. raw webhook data, not
 * pre-verified by the on-chain watcher).
 *
 * Checks:
 *   1. Auto-validates invoice_split / collection_then_settle (no on-chain split to verify)
 *   2. Requires a non-zero transaction value for all other methods
 *   3. For direct payments: value must meet expectedAmountNative (±0.5% tolerance)
 *   4. For atomic_split / contract_split: ALWAYS rejects — a single Alchemy transfer
 *      event carries data for one leg only; proving both merchant AND fee legs requires
 *      on-chain watcher verification (feeCaptureValidated: true)
 *   5. Self-payment guard: sender must not be one of the payment's own wallets
 */
function validateWatcherConfirmation(
  payment: { metadata?: unknown },
  event: Pick<WatcherEvent, "value" | "from">
): { valid: boolean; reason?: string } {
  const split = ((payment.metadata ?? null) as { split?: PaymentSplitMeta } | null)?.split
  const feeCaptureMethod = String(split?.feeCaptureMethod || "").trim().toLowerCase()

  // These methods are confirmed by the provider webhook itself — no on-chain split to verify.
  if (feeCaptureMethod === "invoice_split" || feeCaptureMethod === "collection_then_settle") {
    return { valid: true }
  }

  // Every other method requires a transaction value to be present.
  if (!event.value) {
    return { valid: false, reason: "missing_transaction_value" }
  }

  const txValue = parseFloat(event.value)
  if (!isFinite(txValue) || txValue <= 0) {
    return { valid: false, reason: "invalid_transaction_value" }
  }

  // Direct payments: the full expected amount must have arrived in a single transfer.
  if (feeCaptureMethod === "direct" || !feeCaptureMethod) {
    const expectedNative = Number(split?.expectedAmountNative ?? 0)
    if (expectedNative > 0 && txValue < expectedNative * 0.995) {
      return {
        valid: false,
        reason: `value_insufficient: received ${txValue}, expected >= ${expectedNative}`
      }
    }
  }

  // Split payments (atomic_split / contract_split) require BOTH legs to be verified:
  //   merchant leg >= expectedMerchantAtomic × 0.995
  //   PineTree fee leg >= expectedFeeAtomic × 0.995
  //
  // An Alchemy ADDRESS_ACTIVITY webhook fires once per transfer. Each call to
  // processPaymentEvent therefore carries `value` for a single leg only — there is
  // no way to prove the second leg from the same event. Accepting a single-leg event
  // would allow fee bypass (attacker sends only the merchant leg, skips the fee leg).
  //
  // Resolution: reject all unverified split-payment confirmations here and require
  // feeCaptureValidated: true, which is set only by the on-chain watcher after it
  // independently confirms both outputs in the same transaction.
  if (feeCaptureMethod === "atomic_split" || feeCaptureMethod === "contract_split") {
    const expectedMerchant = Number(
      split?.merchantNativeAmountAtomic ?? split?.expectedMerchantAtomic ?? 0
    )
    const expectedFee = Number(
      split?.feeNativeAmountAtomic ?? split?.expectedFeeAtomic ?? 0
    )

    if (!(expectedMerchant > 0) || !(expectedFee > 0)) {
      return {
        valid: false,
        reason: "insufficient_fee_split_evidence: expected leg amounts missing from metadata"
      }
    }

    // Both required amounts are known but cannot be proven from a single-transfer event.
    return {
      valid: false,
      reason: `insufficient_fee_split_evidence: requires merchant >= ${expectedMerchant} and fee >= ${expectedFee} — both legs must be verified on-chain (feeCaptureValidated: true)`
    }
  }

  // Self-payment guard: the sender must not be one of the payment's own wallets.
  if (event.from) {
    const fromNorm = event.from.toLowerCase()
    if (
      (split?.merchantWallet && fromNorm === split.merchantWallet.toLowerCase()) ||
      (split?.pinetreeWallet && fromNorm === split.pinetreeWallet.toLowerCase())
    ) {
      return { valid: false, reason: "self_payment_detected" }
    }
  }

  return { valid: true }
}

// ─── processPaymentEvent ─────────────────────────────────────────────────────

/**
 * Process a blockchain-detected payment event from the watcher.
 *
 * This is the single authoritative entry point for watcher → engine communication.
 * The watcher detects and matches transactions; all state transitions and DB writes
 * happen here through the standard engine path.
 *
 * payment.processing → advance to PROCESSING only (transaction detected, not yet final)
 * payment.confirmed  → validate transaction, then advance to CONFIRMED + write ledger
 * payment.failed     → advance to FAILED
 */
export async function processPaymentEvent(event: WatcherEvent): Promise<void> {
  const { paymentId, txHash, value, from, feeCaptureValidated } = event
  const targetStatus = watcherEventToStatus[event.type]

  const payment = await getPaymentById(paymentId)
  if (!payment) {
    console.warn("[eventProcessor] processPaymentEvent: payment not found", { paymentId })
    return
  }

  const currentStatus = normalizeToStrictPaymentStatus(payment.status)
  const TERMINAL_STATES = new Set<string>(["CONFIRMED", "FAILED", "INCOMPLETE"])
  if (TERMINAL_STATES.has(currentStatus)) {
    console.info("[eventProcessor] processPaymentEvent: idempotent skip", { paymentId, currentStatus })
    return
  }

  // Validate transaction data before advancing to CONFIRMED when the event has not
  // already been pre-validated by the on-chain watcher (feeCaptureValidated === false).
  if (targetStatus === "CONFIRMED" && !feeCaptureValidated) {
    const validation = validateWatcherConfirmation(payment, { value, from })
    if (!validation.valid) {
      console.warn("[eventProcessor] processPaymentEvent: confirmation rejected", {
        paymentId,
        reason: validation.reason,
        txHash,
        value,
        from
      })

      // For split payments a single-leg webhook transfer is real on-chain activity but
      // cannot satisfy the two-leg proof requirement. Advance to PROCESSING so the UI
      // reflects that the payment is in progress while awaiting full on-chain verification.
      // All other rejection reasons (bad value, self-payment, etc.) are suspect events
      // that should not advance the payment state at all.
      if (validation.reason?.startsWith("insufficient_fee_split_evidence")) {
        const splitMetadata = {
          providerEvent: "watcher.detected",
          rawPayload: { txHash, value, from, feeCaptureValidated: false }
        }
        try {
          await advancePaymentToTargetStatus(paymentId, "PROCESSING", splitMetadata)
          const splitTx = await getTransactionByPaymentId(paymentId)
          if (splitTx) await updateTransactionStatus(splitTx.id, "PROCESSING")
          console.info("[eventProcessor] processPaymentEvent: advanced split payment to PROCESSING", {
            paymentId,
            txHash
          })
        } catch (splitErr: unknown) {
          const splitMsg = splitErr instanceof Error ? splitErr.message : String(splitErr)
          if (!splitMsg.includes("Invalid payment transition")) throw splitErr
          console.warn("[eventProcessor] processPaymentEvent: split PROCESSING transition skipped", {
            paymentId,
            splitMsg
          })
        }
      }

      return
    }
  }

  const transaction = await getTransactionByPaymentId(paymentId)
  if (transaction && txHash && !transaction.provider_transaction_id) {
    try {
      await updateTransactionProviderReference(transaction.id, txHash)
    } catch (error) {
      console.warn("[eventProcessor] processPaymentEvent: failed to update tx reference", error)
    }
  }

  const metadata = {
    providerEvent: "watcher.detected",
    rawPayload: { txHash, value, from, feeCaptureValidated }
  }

  try {
    // Payment advancement always precedes transaction update.
    // If advancePaymentToTargetStatus throws, the catch block below prevents
    // updateTransactionStatus from executing — keeping payment and transaction in sync.
    await advancePaymentToTargetStatus(paymentId, targetStatus, metadata)

    if (transaction) {
      await updateTransactionStatus(transaction.id, toTransactionStatus(targetStatus))
    }

    // Ledger entry is written only on final confirmation — not on detection.
    if (targetStatus === "CONFIRMED") {
      const confirmedPayment = await getPaymentById(paymentId)
      if (confirmedPayment) {
        await upsertLedgerEntry({
          merchant_id: confirmedPayment.merchant_id,
          payment_id: paymentId,
          transaction_id: transaction?.id,
          provider: confirmedPayment.provider,
          network: confirmedPayment.network,
          asset: confirmedPayment.currency,
          amount: confirmedPayment.gross_amount,
          usd_value: confirmedPayment.gross_amount,
          wallet_address: from || confirmedPayment.payment_url,
          direction: "INBOUND",
          status: "CONFIRMED"
        })
      }
    }

    console.info("[eventProcessor] processPaymentEvent: status applied", {
      paymentId,
      targetStatus,
      txHash,
      feeCaptureValidated
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Invalid payment transition")) {
      console.warn("[eventProcessor] processPaymentEvent: invalid transition skipped", { paymentId, message })
    } else {
      throw error
    }
  }
}

export async function processWebhooks(webhooks: WebhookInput[]) {
  const results = await Promise.allSettled(
    webhooks.map((webhook) => processWebhook(webhook))
  )

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  )

  if (failures.length > 0) {
    console.error(`${failures.length} webhooks failed to process`)
  }

  return {
    total: webhooks.length,
    succeeded: results.filter((r) => r.status === "fulfilled").length,
    failed: failures.length
  }
}
