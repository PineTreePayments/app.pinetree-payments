import { getProvider } from "./providerRegistry"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { emitEvent } from "./eventBus"

type WebhookInput = {
  provider: string
  payload: any
  headers?: any
}

type TranslatedEvent = {
  paymentId: string
  event:
    | "payment.processing"
    | "payment.confirmed"
    | "payment.failed"
    | "payment.expired"
    | "payment.refunded"
}

export async function processWebhook({
  provider,
  payload,
  headers
}: WebhookInput) {

  const adapter = getProvider(provider)

  if (!adapter) {
    throw new Error("Unknown provider")
  }

  /* ---------------------------
  SIGNATURE EXTRACTION
  --------------------------- */

  const signature =
    headers?.["x-cc-webhook-signature"] ||
    headers?.["x-signature"] ||
    ""

  /* ---------------------------
  SAFE WEBHOOK VERIFICATION
  --------------------------- */

  let verified = true

  if (adapter.verifyWebhook) {
    verified = adapter.verifyWebhook(payload, signature)
  }

  if (!verified) {
    throw new Error("Webhook verification failed")
  }

  /* ---------------------------
  TRANSLATE EVENT
  --------------------------- */

  let event: TranslatedEvent | null = null

if (adapter.translateEvent) {
  event = adapter.translateEvent(payload) as TranslatedEvent | null
}

if (!event) return

  /* ---------------------------
  NORMALIZE STATUS
  --------------------------- */

  const status = event.event
    .replace("payment.", "")
    .toUpperCase()

  /* ---------------------------
  UPDATE PAYMENT
  --------------------------- */

  await updatePaymentStatus(
    event.paymentId,
    status as any
  )

  /* ---------------------------
  EMIT EVENT
  --------------------------- */

  await emitEvent(event.event, {
    paymentId: event.paymentId
  })

}