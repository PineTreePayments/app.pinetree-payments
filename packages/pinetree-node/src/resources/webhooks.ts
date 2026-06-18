import { createHmac, timingSafeEqual } from "node:crypto"
import { WebhookVerificationError } from "../errors"
import {
  WEBHOOK_SCHEMA,
  WEBHOOK_SCHEMA_HEADER,
  LEGACY_SCHEMA_HEADER,
  type Event,
  type PineTreeEvent,
} from "../types"

const DEFAULT_TOLERANCE_SECONDS = 300

export const PineTreeWebhookHeaders = {
  signature: "PineTree-Signature",
  timestamp: "PineTree-Timestamp",
  eventId: "PineTree-Event-Id",
  schema: WEBHOOK_SCHEMA_HEADER,
  /** @deprecated Use `schema` (PineTree-Event-Schema) instead */
  version: LEGACY_SCHEMA_HEADER,
} as const

export const PineTreeWebhookVersion = WEBHOOK_SCHEMA

export type PineTreeWebhookHeaderValue = string | string[] | undefined
export type PineTreeWebhookHeaderObject = Record<string, PineTreeWebhookHeaderValue>

function normalizeWebhookEventType(type: string) {
  return type === "checkout.session.paid" ? "checkout.session.completed" : type
}

function bodyToBuffer(rawBody: string | Uint8Array) {
  return typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody)
}

function normalizeSignature(signature: string) {
  return signature.trim().replace(/^sha256=/i, "")
}

function readHeader(headers: PineTreeWebhookHeaderObject, ...names: string[]) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  )
  for (const name of names) {
    const value = normalized.get(name.toLowerCase())
    if (Array.isArray(value)) return value[0]
    if (value) return value
  }
  return undefined
}

export class WebhooksResource {
  constructEvent<T = unknown>(
    rawBody: string | Uint8Array,
    signature: string,
    timestamp: string,
    secret: string
  ): Event<T>
  constructEvent<T = unknown>(
    rawBody: string | Uint8Array,
    headers: PineTreeWebhookHeaderObject,
    secret: string
  ): Event<T>
  constructEvent<T = unknown>(
    rawBody: string | Uint8Array,
    signatureOrHeaders: string | PineTreeWebhookHeaderObject,
    timestampOrSecret: string,
    maybeSecret?: string
  ): Event<T> {
    const headers =
      typeof signatureOrHeaders === "object" ? signatureOrHeaders : undefined
    const signature =
      typeof signatureOrHeaders === "string"
        ? signatureOrHeaders
        : readHeader(
            signatureOrHeaders,
            PineTreeWebhookHeaders.signature,
            "X-PineTree-Signature"
          ) || ""
    const timestamp =
      typeof signatureOrHeaders === "string"
        ? timestampOrSecret
        : readHeader(
            signatureOrHeaders,
            PineTreeWebhookHeaders.timestamp,
            "X-PineTree-Timestamp"
          ) || ""
    const secret =
      typeof signatureOrHeaders === "string"
        ? maybeSecret || ""
        : timestampOrSecret

    if (!rawBody || !signature || !timestamp || !secret) {
      throw new WebhookVerificationError(
        "rawBody, signature, timestamp, and secret are required."
      )
    }

    const parsedTimestamp = new Date(timestamp)
    if (Number.isNaN(parsedTimestamp.getTime())) {
      throw new WebhookVerificationError("The PineTree-Timestamp header is invalid.")
    }
    const ageSeconds = Math.abs(Date.now() - parsedTimestamp.getTime()) / 1000
    if (ageSeconds > DEFAULT_TOLERANCE_SECONDS) {
      throw new WebhookVerificationError("The webhook timestamp is outside the tolerance window.")
    }

    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.`)
      .update(bodyToBuffer(rawBody))
      .digest("hex")
    const actual = normalizeSignature(signature)
    const expectedBuffer = Buffer.from(expected, "hex")
    const actualBuffer = Buffer.from(actual, "hex")
    if (
      actual.length !== expected.length ||
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new WebhookVerificationError("Webhook signature verification failed.")
    }

    let event: unknown
    try {
      event = JSON.parse(bodyToBuffer(rawBody).toString("utf8"))
    } catch (error) {
      throw new WebhookVerificationError("Webhook payload is not valid JSON.", {
        cause: error,
      })
    }
    if (
      !event ||
      typeof event !== "object" ||
      typeof (event as Event).eventId !== "string" ||
      (event as Event).object !== "event" ||
      typeof (event as Event).type !== "string" ||
      (event as Event).schema !== PineTreeWebhookVersion ||
      typeof (event as Event).createdAt !== "string" ||
      typeof (event as Event).livemode !== "boolean" ||
      !(event as Event).data?.object
    ) {
      throw new WebhookVerificationError("Webhook payload does not match the v1 event contract.")
    }
    if (headers) {
      const eventId = readHeader(headers, PineTreeWebhookHeaders.eventId)
      if (eventId && eventId !== (event as Event).eventId) {
        throw new WebhookVerificationError(
          "The PineTree-Event-Id header does not match the webhook payload."
        )
      }
      const schema = readHeader(
        headers,
        PineTreeWebhookHeaders.schema,
        PineTreeWebhookHeaders.version
      )
      if (schema && schema !== PineTreeWebhookVersion) {
        throw new WebhookVerificationError(
          `Unsupported PineTree event schema: ${schema}.`
        )
      }
    }
    return {
      ...event as PineTreeEvent,
      type: normalizeWebhookEventType((event as Event).type),
    } as Event<T>
  }
}
