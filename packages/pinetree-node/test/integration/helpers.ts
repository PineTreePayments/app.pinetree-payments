import { createHmac, randomUUID } from "node:crypto"
import {
  PineTreeWebhookHeaders,
  PineTreeWebhookVersion,
  type Event,
  type PineTreeWebhookHeaderObject,
} from "../../src"

const PRODUCTION_HOSTS = new Set([
  "app.pinetree-payments.com",
  "www.app.pinetree-payments.com",
])

export type IntegrationConfig = {
  baseUrl: string
  apiKey: string
  webhookSecret: string
  paymentId?: string
}

export type IntegrationEnvironment =
  | { enabled: true; config: IntegrationConfig }
  | { enabled: false; reason: string }

export function loadIntegrationEnvironment(
  env: Record<string, string | undefined> = process.env
): IntegrationEnvironment {
  if (env.PINETREE_RUN_INTEGRATION !== "true") {
    return {
      enabled: false,
      reason: "integration execution was not explicitly requested",
    }
  }

  const baseUrl = env.PINETREE_INTEGRATION_BASE_URL?.trim()
  const apiKey = env.PINETREE_INTEGRATION_API_KEY?.trim()
  const webhookSecret = env.PINETREE_INTEGRATION_WEBHOOK_SECRET?.trim()
  const missing = [
    !baseUrl && "PINETREE_INTEGRATION_BASE_URL",
    !apiKey && "PINETREE_INTEGRATION_API_KEY",
    !webhookSecret && "PINETREE_INTEGRATION_WEBHOOK_SECRET",
  ].filter(Boolean)

  if (missing.length > 0) {
    return {
      enabled: false,
      reason: `missing required environment variables: ${missing.join(", ")}`,
    }
  }
  if (!baseUrl || !apiKey || !webhookSecret) {
    return {
      enabled: false,
      reason: "required integration environment variables are unavailable",
    }
  }

  let parsedBaseUrl: URL
  try {
    parsedBaseUrl = new URL(baseUrl)
  } catch {
    throw new Error("PINETREE_INTEGRATION_BASE_URL must be a valid HTTP(S) URL.")
  }
  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
    throw new Error("PINETREE_INTEGRATION_BASE_URL must use HTTP or HTTPS.")
  }

  // Production safety: require explicit opt-in for known production hosts.
  // PineTree uses a single pt_live_* key format for all environments; a
  // locally-created pt_live_* key is safe against a local server.
  if (
    PRODUCTION_HOSTS.has(parsedBaseUrl.hostname.toLowerCase()) &&
    env.PINETREE_ALLOW_PRODUCTION_INTEGRATION !== "true"
  ) {
    throw new Error(
      "Production integration tests require PINETREE_ALLOW_PRODUCTION_INTEGRATION=true."
    )
  }

  return {
    enabled: true,
    config: {
      baseUrl: parsedBaseUrl.origin,
      apiKey,
      webhookSecret,
      paymentId: env.PINETREE_INTEGRATION_PAYMENT_ID?.trim() || undefined,
    },
  }
}

export function integrationReference(operation: string) {
  return `sdk-integration-${operation}-${randomUUID()}`
}

export function createSignedWebhookFixture<T>(
  object: T,
  secret: string,
  timestamp = new Date().toISOString()
) {
  const event: Event<T> = {
    eventId: `evt_test_${randomUUID()}`,
    object: "event",
    type: "checkout.session.created",
    schema: "payments-v1",
    createdAt: timestamp,
    livemode: false,
    data: { object },
  }
  const rawBody = JSON.stringify(event)
  const signature = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex")}`
  const headers: PineTreeWebhookHeaderObject = {
    [PineTreeWebhookHeaders.signature]: signature,
    [PineTreeWebhookHeaders.timestamp]: timestamp,
    [PineTreeWebhookHeaders.eventId]: event.eventId,
    [PineTreeWebhookHeaders.schema]: PineTreeWebhookVersion,
    [PineTreeWebhookHeaders.version]: PineTreeWebhookVersion,
  }

  return { event, rawBody, headers }
}
