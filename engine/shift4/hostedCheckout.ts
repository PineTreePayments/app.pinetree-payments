/** Hosted-checkout orchestration. Provider modules stay transport-only; the Engine owns persistence. */
import { getPaymentById } from "@/database/payments"
import {
  consumeShift4TokenizationSession,
  createShift4TokenizationSession,
  getShift4TokenizationSession,
} from "@/database/shift4TokenizationSessions"
import { createShift4I4GoSession, readShift4I4GoCallbackToken } from "@/providers/shift4/i4go"
import { getShift4PaymentAttempt } from "@/database/shift4PaymentAttempts"
import { deriveAttemptId } from "./attempt"
import { executeMerchantShift4Operation } from "./services"
import { assertShift4Capability, resolveShift4Readiness } from "./readiness"

export async function beginShift4HostedCheckout(input: {
  merchantId: string
  paymentId: string
  merchantProviderConnectionId: string
}) {
  const readiness = await resolveShift4Readiness(input.merchantId)
  assertShift4Capability(readiness, "hosted_checkout")
  if (readiness.connectionId !== input.merchantProviderConnectionId) {
    throw Object.assign(new Error("Shift4 connection does not belong to this merchant"), { status: 403, code: "connection_mismatch" })
  }
  const payment = await getPaymentById(input.paymentId)
  if (!payment || String(payment.merchant_id) !== input.merchantId) {
    throw Object.assign(new Error("Payment not found"), { status: 404, code: "payment_not_found" })
  }
  const session = await createShift4I4GoSession({})
  await createShift4TokenizationSession({ ...input, ...session })
  return session
}

export async function completeShift4HostedCheckout(input: {
  merchantId: string
  sessionId: string
  completionSecret: string
  cardToken: unknown
}) {
  const stored = await getShift4TokenizationSession(input.merchantId, input.sessionId)
  if (!stored) throw Object.assign(new Error("Tokenization session not found"), { status: 404, code: "not_found" })
  const cardToken = readShift4I4GoCallbackToken({ cardToken: input.cardToken })
  const consumed = await consumeShift4TokenizationSession({ ...input, cardToken })
  if (consumed === "unavailable") throw Object.assign(new Error("Tokenization session is invalid or expired"), { status: 409, code: "tokenization_session_unavailable" })
  if (consumed === "fingerprint_conflict") throw Object.assign(new Error("Tokenization session was already consumed with different token evidence"), { status: 409, code: "tokenization_session_conflict" })
  return {
    cardToken: consumed === "consumed_now" ? cardToken : null,
    alreadyConsumed: consumed === "already_consumed",
    paymentId: stored.payment_id,
    merchantProviderConnectionId: stored.merchant_provider_connection_id,
  }
}

function paymentAmountMinor(value: unknown): number {
  const match = String(value).trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error("Payment has an invalid authoritative gross amount")
  const fraction = (match[2] || "").padEnd(2, "0")
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) throw new Error("Payment amount has fractional minor units")
  const whole = Number(match[1])
  const cents = Number(fraction.slice(0, 2))
  const result = whole * 100 + cents
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Payment amount is outside safe minor-unit range")
  return result
}

export async function completeAndExecuteShift4HostedCheckout(input: {
  merchantId: string
  sessionId: string
  completionSecret: string
  cardToken: unknown
  operation: "sale" | "authorization"
  idempotencyKey: string
  correlationId?: string
}) {
  const completion = await completeShift4HostedCheckout(input)
  if (completion.alreadyConsumed) {
    const attemptId = deriveAttemptId({ paymentId: completion.paymentId, operation: input.operation, idempotencyKey: input.idempotencyKey })
    const attempt = await getShift4PaymentAttempt(input.merchantId, attemptId)
    if (!attempt) throw Object.assign(new Error("Tokenization was consumed; payment status is pending reconciliation"), { status: 409, code: "tokenization_reconciliation_required" })
    return { resumed: true, attemptId, state: attempt.state, recoveryState: attempt.recovery_state }
  }
  const payment = await getPaymentById(completion.paymentId)
  if (!payment || String(payment.merchant_id) !== input.merchantId) throw Object.assign(new Error("Payment not found"), { status: 404, code: "payment_not_found" })
  return executeMerchantShift4Operation(input.merchantId, {
    merchantProviderConnectionId: completion.merchantProviderConnectionId,
    paymentId: completion.paymentId,
    operation: input.operation,
    channel: "ecommerce",
    amountMinor: paymentAmountMinor(payment.gross_amount),
    currency: String(payment.currency || "USD"),
    idempotencyKey: input.idempotencyKey,
    cardTokenValue: completion.cardToken || undefined,
    correlationId: input.correlationId,
  })
}
