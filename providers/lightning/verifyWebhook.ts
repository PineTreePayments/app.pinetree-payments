import crypto from "crypto"
import type { LightningProviderConfig } from "./types"

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function readHeader(headers: Record<string, string> | undefined, name: string): string {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) return String(value || "").trim()
  }
  return ""
}

function normalizeSignature(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^sha256=/, "")
    .replace(/^v1,/, "")
}

function decodeSpeedWebhookSecret(secret: string): Buffer {
  const normalized = secret.startsWith("wsec_") ? secret.slice("wsec_".length) : secret
  return Buffer.from(normalized, "base64")
}

export function verifyLightningWebhook(
  payload: unknown,
  signature?: string,
  rawBody?: string,
  config?: LightningProviderConfig,
  headers?: Record<string, string>
): boolean {
  void payload

  const secret = String(config?.webhookSecret || "").trim()
  if (!secret) return false

  const body = String(rawBody || "")
  if (!body) return false

  const speedSignature = readHeader(headers, "webhook-signature") || String(signature || "").trim()
  const webhookId = readHeader(headers, "webhook-id")
  const timestamp = readHeader(headers, "webhook-timestamp")

  if (speedSignature && webhookId && timestamp) {
    const signedPayload = `${webhookId}.${timestamp}.${body}`
    const expected = crypto
      .createHmac("sha256", decodeSpeedWebhookSecret(secret))
      .update(signedPayload)
      .digest("base64")

    return timingSafeEqual(normalizeSignature(speedSignature), expected)
  }

  const received = String(signature || "").trim()
  if (!received) return false

  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex")

  return timingSafeEqual(normalizeSignature(received), expected)
}
