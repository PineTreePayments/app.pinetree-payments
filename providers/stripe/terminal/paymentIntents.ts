import { StripeClient } from "../client"
import { normalizeStripePaymentStatus, stripeAmountToMinorUnits } from "../payments"
import type { PaymentStatus } from "@/types/provider"

/**
 * Card PaymentIntent creation for the three PineTree card capture paths.
 *
 * | Path            | Stripe payment method | PineTree channel | capture method   |
 * |-----------------|-----------------------|------------------|------------------|
 * | Terminal reader | card_present          | in_person        | terminal_reader  |
 * | Tap to Pay      | card_present          | in_person        | tap_to_pay       |
 * | Manual entry    | card (CNP)            | in_person        | manual_entry     |
 * | Hosted checkout | automatic methods     | online           | online_element   |
 *
 * Hosted/online creation stays in ../payments.ts (existing flow); this
 * module owns the in-person paths. A card_present PaymentIntent is never
 * mutated into a card intent — switching to manual entry always creates a
 * new PaymentIntent (see engine/stripeTerminalPayments.ts).
 *
 * Amounts are always the server-computed PineTree gross amount; metadata
 * carries only safe PineTree references, never customer data.
 */

export type StripeCardChannel = "online" | "in_person" | "remote"
export type StripeCardCaptureMethod =
  | "online_element"
  | "payment_link"
  | "terminal_reader"
  | "tap_to_pay"
  | "manual_entry"

export type StripeCardPaymentIntentResult = {
  id: string
  clientSecret: string | null
  status: PaymentStatus
  providerStatus: string
  amount: number
  currency: string
}

function buildMetadata(params: {
  paymentId: string
  merchantId: string
  channel: StripeCardChannel
  captureMethod: StripeCardCaptureMethod
}): Record<string, string> {
  return {
    paymentId: params.paymentId,
    pinetree_payment_id: params.paymentId,
    merchantId: params.merchantId,
    pinetree_merchant_id: params.merchantId,
    provider: "stripe",
    network: "stripe",
    pinetree_channel: params.channel,
    pinetree_capture_method: params.captureMethod
  }
}

function normalizeIntent(raw: {
  id: string
  client_secret?: string | null
  status?: string
  amount?: number
  currency?: string
}): StripeCardPaymentIntentResult {
  return {
    id: raw.id,
    clientSecret: raw.client_secret || null,
    status: normalizeStripePaymentStatus(raw.status),
    providerStatus: String(raw.status || ""),
    amount: Number(raw.amount || 0),
    currency: String(raw.currency || "usd")
  }
}

/**
 * Card-present PaymentIntent for server-driven readers (and future native
 * Tap to Pay). Idempotent per PineTree payment via the idempotency key.
 */
export async function createCardPresentPaymentIntent(params: {
  connectedAccountId: string
  paymentId: string
  merchantId: string
  grossAmount: number
  currency: string
  captureMethod: "terminal_reader" | "tap_to_pay"
}): Promise<StripeCardPaymentIntentResult> {
  const client = new StripeClient()
  const raw = await client.createPaymentIntentFromBody(
    {
      amount: stripeAmountToMinorUnits(params.grossAmount),
      currency: String(params.currency || "usd").trim().toLowerCase() || "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      metadata: buildMetadata({
        paymentId: params.paymentId,
        merchantId: params.merchantId,
        channel: "in_person",
        captureMethod: params.captureMethod
      })
    },
    `${params.paymentId}:card_present`,
    params.connectedAccountId
  )

  return normalizeIntent(raw)
}

/**
 * Manual card entry: a card-not-present `card` PaymentIntent, even when the
 * buyer is physically present. Always a separate PaymentIntent from any
 * Terminal attempt (idempotency scope ":manual_entry").
 */
export async function createManualEntryPaymentIntent(params: {
  connectedAccountId: string
  paymentId: string
  merchantId: string
  grossAmount: number
  currency: string
}): Promise<StripeCardPaymentIntentResult> {
  const client = new StripeClient()
  const raw = await client.createPaymentIntentFromBody(
    {
      amount: stripeAmountToMinorUnits(params.grossAmount),
      currency: String(params.currency || "usd").trim().toLowerCase() || "usd",
      payment_method_types: ["card"],
      metadata: buildMetadata({
        paymentId: params.paymentId,
        merchantId: params.merchantId,
        channel: "in_person",
        captureMethod: "manual_entry"
      })
    },
    `${params.paymentId}:manual_entry`,
    params.connectedAccountId
  )

  return normalizeIntent(raw)
}

export async function retrieveCardPaymentIntent(params: {
  connectedAccountId: string
  paymentIntentId: string
}): Promise<StripeCardPaymentIntentResult> {
  const client = new StripeClient()
  const raw = await client.retrievePaymentIntent(params.paymentIntentId, params.connectedAccountId)
  return normalizeIntent(raw)
}

export async function cancelCardPaymentIntent(params: {
  connectedAccountId: string
  paymentIntentId: string
}): Promise<StripeCardPaymentIntentResult> {
  const client = new StripeClient()
  const raw = await client.cancelPaymentIntent(params.paymentIntentId, params.connectedAccountId)
  return normalizeIntent(raw)
}
