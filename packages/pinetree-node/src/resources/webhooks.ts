import { createHmac, timingSafeEqual } from "node:crypto"
import { WebhookVerificationError } from "../errors"
import type { Event } from "../types"

const DEFAULT_TOLERANCE_SECONDS = 300

export const PineTreeWebhookHeaders = {
  signature: "PineTree-Signature",
  timestamp: "PineTree-Timestamp",
  eventId: "PineTree-Event-Id",
  version: "PineTree-Webhook-Version",
} as const

export const PineTreeWebhookVersion = "2026-06-12"

function bodyToBuffer(rawBody: string | Uint8Array) {
  return typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody)
}

function normalizeSignature(signature: string) {
  return signature.trim().replace(/^sha256=/i, "")
}

export class WebhooksResource {
  constructEvent<T = unknown>(
    rawBody: string | Uint8Array,
    signature: string,
    timestamp: string,
    secret: string
  ): Event<T> {
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
      typeof (event as Event).type !== "string" ||
      typeof (event as Event).createdAt !== "string" ||
      !(event as Event).data?.object
    ) {
      throw new WebhookVerificationError("Webhook payload does not match the v1 event contract.")
    }
    return event as Event<T>
  }
}
