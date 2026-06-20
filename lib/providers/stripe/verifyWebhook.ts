import crypto from "crypto"
import {
  STRIPE_SIGNATURE_HEADER,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS
} from "./constants"

type VerifyWebhookInput = {
  rawBody?: string
  headers?: Record<string, string | undefined>
  signature?: string
  webhookSecret?: string
  now?: number
}

function getHeader(headers: Record<string, string | undefined> | undefined, name: string): string {
  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === lowerName) return String(value || "")
  }
  return ""
}

function parseStripeSignatureHeader(header: string): { timestamp?: number; signatures: string[] } {
  const parts = header.split(",").map((part) => part.trim()).filter(Boolean)
  const signatures: string[] = []
  let timestamp: number | undefined

  for (const part of parts) {
    const [key, value] = part.split("=", 2)
    if (key === "t") timestamp = Number(value)
    if (key === "v1" && value) signatures.push(value)
  }

  return { timestamp, signatures }
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function verifyWebhook({
  rawBody,
  headers,
  signature,
  webhookSecret,
  now = Math.floor(Date.now() / 1000)
}: VerifyWebhookInput): boolean {
  const secret = String(webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || "").trim()
  if (!secret) return false

  const signatureHeader =
    String(signature || "").trim() ||
    getHeader(headers, STRIPE_SIGNATURE_HEADER)

  if (!rawBody || !signatureHeader) return false

  const parsed = parseStripeSignatureHeader(signatureHeader)
  if (!parsed.timestamp || parsed.signatures.length === 0) return false

  if (Math.abs(now - parsed.timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) return false

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`, "utf8")
    .digest("hex")

  return parsed.signatures.some((candidate) => timingSafeHexEqual(candidate, expected))
}
