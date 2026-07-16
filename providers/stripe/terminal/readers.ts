import { StripeClient } from "../client"
import type { StripeReaderActionState, StripeReaderStatus, StripeTerminalReader } from "./types"

/**
 * Stripe Terminal reader registration and synchronization.
 *
 * SECURITY: registration codes are pass-through only — they are sent to
 * Stripe once and are never returned, persisted, or logged. Readers live on
 * the merchant's connected account (direct-charge model, ../chargeModel.ts);
 * the connectedAccountId is always resolved server-side.
 */

export function normalizeReaderStatus(raw: unknown): StripeReaderStatus {
  const value = String(raw || "").toLowerCase().trim()
  if (value === "online") return "online"
  if (value === "offline") return "offline"
  return "unknown"
}

export function normalizeTerminalReader(raw: Record<string, unknown>): StripeTerminalReader {
  const deviceType = String(raw.device_type || "")
  return {
    id: String(raw.id || ""),
    label: String(raw.label || ""),
    deviceType,
    serialNumber: String(raw.serial_number || "") || null,
    status: normalizeReaderStatus(raw.status),
    locationId: typeof raw.location === "string"
      ? raw.location
      : String((raw.location as Record<string, unknown> | null)?.id || "") || null,
    simulated: deviceType.startsWith("simulated"),
    livemode: raw.livemode === true
  }
}

export function normalizeReaderAction(raw: Record<string, unknown> | null | undefined): StripeReaderActionState {
  const action = (raw?.action || null) as Record<string, unknown> | null
  if (!action) {
    return { type: null, status: "none", paymentIntentId: null, failureCode: null, failureMessage: null }
  }

  const processPaymentIntent = (action.process_payment_intent || {}) as Record<string, unknown>
  const paymentIntent = processPaymentIntent.payment_intent
  const status = String(action.status || "").toLowerCase()

  return {
    type: String(action.type || "") || null,
    status: status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : "in_progress",
    paymentIntentId: typeof paymentIntent === "string"
      ? paymentIntent
      : String((paymentIntent as Record<string, unknown> | null)?.id || "") || null,
    failureCode: String(action.failure_code || "") || null,
    failureMessage: String(action.failure_message || "") || null
  }
}

export async function registerStripeTerminalReader(params: {
  connectedAccountId: string
  registrationCode: string
  label?: string
  stripeLocationId: string
}): Promise<StripeTerminalReader> {
  const registrationCode = String(params.registrationCode || "").trim()
  if (!registrationCode) throw new Error("Reader registration code is required")
  if (!String(params.stripeLocationId || "").trim()) {
    throw new Error("A Terminal location is required to register a reader")
  }

  const client = new StripeClient()
  const raw = await client.createTerminalReader(
    {
      registration_code: registrationCode,
      location: params.stripeLocationId,
      ...(String(params.label || "").trim() ? { label: String(params.label).trim() } : {})
    },
    params.connectedAccountId
  )

  // Normalization drops the registration code by construction — the raw
  // request body is never returned or stored.
  return normalizeTerminalReader(raw)
}

export async function retrieveStripeTerminalReader(params: {
  connectedAccountId: string
  stripeReaderId: string
}): Promise<{ reader: StripeTerminalReader; action: StripeReaderActionState }> {
  const client = new StripeClient()
  const raw = await client.retrieveTerminalReader(params.stripeReaderId, params.connectedAccountId)
  return { reader: normalizeTerminalReader(raw), action: normalizeReaderAction(raw) }
}

export async function listStripeTerminalReaders(params: {
  connectedAccountId: string
}): Promise<StripeTerminalReader[]> {
  const client = new StripeClient()
  const response = await client.listTerminalReaders(params.connectedAccountId)
  return (response.data || []).map(normalizeTerminalReader)
}
