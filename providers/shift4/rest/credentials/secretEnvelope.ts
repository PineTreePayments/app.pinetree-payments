/**
 * AES-256-GCM envelope for the merchant-scoped Shift4 access token.
 *
 * This is the only module allowed to encrypt or decrypt a Shift4 access token.
 * It mirrors the established PineTree convention in
 * providers/lightning/speedCredentialCrypto.ts, but keeps ciphertext, IV, and
 * auth tag together in one JSON-storable object so the envelope can live inside
 * the existing merchant_providers.credentials JSONB column without any schema
 * change and without a new plaintext credential column.
 *
 * The key must be a 64-character hex string (32 bytes) in
 * SHIFT4_CREDENTIAL_ENCRYPTION_KEY. Never hardcode it, never log it, never
 * expose it through NEXT_PUBLIC_*.
 *
 * NOTE: the Shift4 AUTH token is never encrypted here because it is never
 * stored. Production auth tokens are single-use and are discarded immediately
 * after a successful exchange.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm" as const
const IV_BYTES = 12 // 96-bit IV is the GCM recommendation
const ENVELOPE_VERSION = 1 as const

export type Shift4EncryptedSecret = {
  /** Envelope format version, so a future key/format migration stays detectable. */
  v: typeof ENVELOPE_VERSION
  alg: typeof ALGORITHM
  ciphertext: string
  iv: string
  authTag: string
}

export class Shift4CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "Shift4CredentialCryptoError"
  }
}

function loadShift4CredentialEncryptionKey(): Buffer {
  const hex = String(process.env.SHIFT4_CREDENTIAL_ENCRYPTION_KEY || "").trim()
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Shift4CredentialCryptoError(
      "SHIFT4_CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  return Buffer.from(hex, "hex")
}

export function encryptShift4AccessToken(plaintext: string): Shift4EncryptedSecret {
  const value = String(plaintext || "")
  if (!value) {
    throw new Shift4CredentialCryptoError("Refusing to encrypt an empty Shift4 access token.")
  }
  const key = loadShift4CredentialEncryptionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return {
    v: ENVELOPE_VERSION,
    alg: ALGORITHM,
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  }
}

export function decryptShift4AccessToken(envelope: Shift4EncryptedSecret): string {
  if (!isShift4EncryptedSecret(envelope)) {
    throw new Shift4CredentialCryptoError("Stored Shift4 credential is not a recognized encrypted envelope.")
  }
  const key = loadShift4CredentialEncryptionKey()
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"))
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"))
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    // GCM authentication failed: wrong key, or the stored envelope was altered.
    // The underlying error is swallowed so nothing about the key is revealed.
    throw new Shift4CredentialCryptoError(
      "Shift4 access token could not be decrypted. The encryption key may have changed or the stored value was modified."
    )
  }
}

export function isShift4EncryptedSecret(value: unknown): value is Shift4EncryptedSecret {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<Shift4EncryptedSecret>
  return (
    candidate.v === ENVELOPE_VERSION &&
    candidate.alg === ALGORITHM &&
    typeof candidate.ciphertext === "string" && candidate.ciphertext.length > 0 &&
    typeof candidate.iv === "string" && candidate.iv.length > 0 &&
    typeof candidate.authTag === "string" && candidate.authTag.length > 0
  )
}
