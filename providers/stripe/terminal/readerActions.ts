import { StripeClient, type StripeApiError } from "../client"
import { normalizeReaderAction, normalizeTerminalReader } from "./readers"
import {
  StripeReaderOperationError,
  type StripeReaderActionState,
  type StripeReaderErrorKind,
  type StripeTerminalReader
} from "./types"

/**
 * Server-driven reader actions. Raw Stripe errors are normalized into
 * StripeReaderOperationError kinds so PineTree Engine and routes never leak
 * provider internals to the client.
 */

function classifyReaderError(error: unknown): StripeReaderErrorKind {
  const stripeCode = String((error as StripeApiError)?.stripeCode || "").toLowerCase()
  const message = String((error as Error)?.message || "").toLowerCase()

  if (stripeCode === "terminal_reader_busy" || message.includes("busy") || message.includes("in progress")) {
    return "reader_busy"
  }
  if (stripeCode === "terminal_reader_offline" || message.includes("offline")) {
    return "reader_offline"
  }
  if (stripeCode === "terminal_reader_timeout" || message.includes("timed out") || message.includes("timeout")) {
    return "reader_timeout"
  }
  if (message.includes("payment_intent") || message.includes("paymentintent")) {
    return "intent_invalid"
  }
  return "provider_error"
}

const READER_ERROR_MESSAGES: Record<StripeReaderErrorKind, string> = {
  reader_busy: "The card reader is busy with another payment.",
  reader_offline: "The card reader is offline. Check its network connection.",
  reader_timeout: "The card reader did not respond in time.",
  intent_invalid: "This payment can no longer be sent to a reader.",
  provider_error: "The card reader could not process this request."
}

function toReaderOperationError(error: unknown): StripeReaderOperationError {
  const kind = classifyReaderError(error)
  console.error("[stripe/terminal] reader operation failed", {
    kind,
    stripeCode: (error as StripeApiError)?.stripeCode || null,
    message: error instanceof Error ? error.message : String(error)
  })
  return new StripeReaderOperationError(kind, READER_ERROR_MESSAGES[kind])
}

/**
 * Hands a card_present PaymentIntent to a server-driven reader. Retries are
 * NOT performed here — a failed hand-off may still reach the reader, so the
 * caller must re-check reader state before any retry.
 */
export async function processPaymentIntentOnReader(params: {
  connectedAccountId: string
  stripeReaderId: string
  paymentIntentId: string
}): Promise<{ reader: StripeTerminalReader; action: StripeReaderActionState }> {
  const client = new StripeClient()
  try {
    const raw = await client.processPaymentIntentOnReader(
      params.stripeReaderId,
      { payment_intent: params.paymentIntentId },
      params.connectedAccountId,
      `${params.paymentIntentId}:process:${params.stripeReaderId}`
    )
    return { reader: normalizeTerminalReader(raw), action: normalizeReaderAction(raw) }
  } catch (error) {
    throw toReaderOperationError(error)
  }
}

export async function cancelReaderAction(params: {
  connectedAccountId: string
  stripeReaderId: string
}): Promise<{ reader: StripeTerminalReader; action: StripeReaderActionState }> {
  const client = new StripeClient()
  try {
    const raw = await client.cancelTerminalReaderAction(params.stripeReaderId, params.connectedAccountId)
    return { reader: normalizeTerminalReader(raw), action: normalizeReaderAction(raw) }
  } catch (error) {
    throw toReaderOperationError(error)
  }
}

export async function getReaderActionState(params: {
  connectedAccountId: string
  stripeReaderId: string
}): Promise<{ reader: StripeTerminalReader; action: StripeReaderActionState }> {
  const client = new StripeClient()
  try {
    const raw = await client.retrieveTerminalReader(params.stripeReaderId, params.connectedAccountId)
    return { reader: normalizeTerminalReader(raw), action: normalizeReaderAction(raw) }
  } catch (error) {
    throw toReaderOperationError(error)
  }
}
