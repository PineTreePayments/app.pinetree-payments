import { getShift4WebhookSecret } from "./constants"

export type Shift4WebhookVerificationInput = {
  payload: unknown
  rawBody?: string
  signature?: string
  headers?: Record<string, string>
}

export function verifyWebhook(input: Shift4WebhookVerificationInput): boolean {
  const secret = getShift4WebhookSecret()
  void input
  void secret

  if (process.env.NODE_ENV !== "production" && process.env.SHIFT4_WEBHOOK_TEST_BYPASS === "true") {
    return true
  }

  // TODO(shift4-docs): The public Shift4 webhook docs say webhook bodies
  // contain event JSON and recommend using the event id to retrieve the event
  // from the Shift4 API, but they do not document a signature header, timestamp
  // header, HMAC payload, digest encoding, or replay tolerance. Until Shift4
  // provides those exact details, production verification must fail closed.
  return false
}
