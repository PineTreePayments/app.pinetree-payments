/**
 * Bridge (by Stripe) - webhook signature verification.
 *
 * Bridge signs each delivery with the per-endpoint RSA private key and
 * publishes the matching public key in the Bridge Dashboard.
 *
 *   Header:      X-Webhook-Signature: t=<timestamp>,v0=<base64 signature>
 *   Timestamp:   MILLISECONDS since epoch
 *   Signed text: `${timestamp}.${rawRequestBody}`
 *   Algorithm:   RSA with SHA-256, signature base64-encoded
 *   Key:         PEM-encoded X.509 public key
 *
 * Bridge's guidance is to reject events older than a few minutes (e.g. 10) and
 * return 400 so the delivery is retried.
 *
 * SECURITY: verification runs against the RAW request body. Parsing before
 * verifying would mean trusting an unverified payload, so the caller must pass
 * the exact bytes received.
 */

import { createVerify, timingSafeEqual } from "node:crypto"

import { getBridgeWebhookPublicKey } from "./config"

/** Bridge's documented signature header. */
export const BRIDGE_SIGNATURE_HEADER = "x-webhook-signature" as const

/** Documented replay window: reject events older than 10 minutes. */
export const BRIDGE_WEBHOOK_TOLERANCE_MS = 10 * 60 * 1000

export type BridgeSignatureParts = {
  timestampMs: number
  signatureBase64: string
}

export type BridgeWebhookVerificationResult =
  | { valid: true; timestampMs: number }
  | { valid: false; reason: BridgeWebhookRejectionReason }

export type BridgeWebhookRejectionReason =
  | "missing_signature_header"
  | "malformed_signature_header"
  | "missing_public_key"
  | "timestamp_outside_tolerance"
  | "signature_mismatch"
  | "verification_error"

/**
 * Parse `t=<timestamp>,v0=<base64>`.
 *
 * Parts are matched by prefix rather than position so a future added field
 * cannot break parsing, and an unparseable header yields null instead of a
 * partially trusted value.
 */
export function parseBridgeSignatureHeader(header: string | null | undefined): BridgeSignatureParts | null {
  const raw = String(header || "").trim()
  if (!raw) return null

  let timestampMs: number | null = null
  let signatureBase64 = ""

  for (const segment of raw.split(",")) {
    const trimmed = segment.trim()
    if (trimmed.startsWith("t=")) {
      const value = trimmed.slice(2).trim()
      if (!/^\d{1,20}$/.test(value)) return null
      timestampMs = Number(value)
    } else if (trimmed.startsWith("v0=")) {
      signatureBase64 = trimmed.slice(3).trim()
    }
  }

  if (timestampMs === null || !Number.isFinite(timestampMs) || !signatureBase64) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)) return null

  return { timestampMs, signatureBase64 }
}

/**
 * True when the signed timestamp is inside the replay window.
 *
 * Both directions are bounded: a far-future timestamp is rejected too, so a
 * forged header cannot buy an unlimited replay lifetime.
 */
export function isBridgeTimestampFresh(
  timestampMs: number,
  nowMs: number,
  toleranceMs: number = BRIDGE_WEBHOOK_TOLERANCE_MS
): boolean {
  return Math.abs(nowMs - timestampMs) <= toleranceMs
}

/**
 * Verify a Bridge webhook delivery.
 *
 * Returns a result rather than throwing so the route can log a precise reason
 * without leaking the payload or the signature.
 */
export function verifyBridgeWebhookSignature(input: {
  rawBody: string
  signatureHeader: string | null | undefined
  publicKeyPem?: string
  nowMs?: number
  toleranceMs?: number
}): BridgeWebhookVerificationResult {
  const parts = parseBridgeSignatureHeader(input.signatureHeader)
  if (!input.signatureHeader) return { valid: false, reason: "missing_signature_header" }
  if (!parts) return { valid: false, reason: "malformed_signature_header" }

  let publicKeyPem: string
  try {
    publicKeyPem = input.publicKeyPem ?? getBridgeWebhookPublicKey()
  } catch {
    return { valid: false, reason: "missing_public_key" }
  }

  const nowMs = input.nowMs ?? Date.now()
  const toleranceMs = input.toleranceMs ?? BRIDGE_WEBHOOK_TOLERANCE_MS
  if (!isBridgeTimestampFresh(parts.timestampMs, nowMs, toleranceMs)) {
    return { valid: false, reason: "timestamp_outside_tolerance" }
  }

  try {
    const verifier = createVerify("RSA-SHA256")
    verifier.update(`${parts.timestampMs}.${input.rawBody}`)
    verifier.end()

    const signature = Buffer.from(parts.signatureBase64, "base64")
    if (signature.length === 0) return { valid: false, reason: "malformed_signature_header" }

    if (!verifier.verify(publicKeyPem, signature)) {
      return { valid: false, reason: "signature_mismatch" }
    }
    return { valid: true, timestampMs: parts.timestampMs }
  } catch {
    // A malformed key or signature must fail closed, never fall through to
    // "accepted".
    return { valid: false, reason: "verification_error" }
  }
}

/**
 * Constant-time comparison helper retained for any future Bridge scheme that
 * uses a shared secret rather than PKI. RSA verification is already
 * constant-time inside OpenSSL.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
