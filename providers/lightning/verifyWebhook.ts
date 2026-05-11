import crypto from "crypto"
import type { LightningProviderConfig } from "./types"

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function verifyLightningWebhook(
  payload: unknown,
  signature?: string,
  rawBody?: string,
  config?: LightningProviderConfig
): boolean {
  void payload

  const secret = String(config?.webhookSecret || "").trim()
  if (!secret) return false

  const body = String(rawBody || "")
  const received = String(signature || "").trim()
  if (!body || !received) return false

  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex")

  return timingSafeEqual(received.replace(/^sha256=/, ""), expected)
}
