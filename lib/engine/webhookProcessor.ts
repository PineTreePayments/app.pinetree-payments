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

  // extract signature if present
  const signature =
    headers?.["x-cc-webhook-signature"] ||
    headers?.["x-signature"] ||
    ""

  const verified = adapter.verifyWebhook(payload, signature)

  if (!verified) {
    throw new Error("Webhook verification failed")
  }

  const event = adapter.translateEvent(payload) as TranslatedEvent | null

  if (!event) return

  const status = event.event
    .replace("payment.", "")
    .toUpperCase()

  await updatePaymentStatus(
    event.paymentId,
    status
  )

  await emitEvent(event.event, {
    paymentId: event.paymentId
  })

}