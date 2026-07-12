/**
 * AES-256-GCM encryption for retained Speed Custom Connect account passwords
 * (merchant_speed_credentials.encrypted_password/encryption_iv/encryption_auth_tag).
 *
 * This is the only module allowed to encrypt or decrypt a Speed account
 * password - do not duplicate this logic in routes or database modules.
 * The key must be a 64-character hex string (32 bytes). Store it in
 * SPEED_CREDENTIAL_ENCRYPTION_KEY - never hardcode it, never log it.
 *
 * Mirrors integrations/shopify/lib/crypto.ts's AES-256-GCM convention, but
 * keeps IV and auth tag as separate fields to match merchant_speed_credentials'
 * column layout rather than a single dot-joined string.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm" as const
const IV_BYTES = 12 // 96-bit IV is the GCM recommendation

function loadSpeedCredentialEncryptionKey(): Buffer {
  const hex = String(process.env.SPEED_CREDENTIAL_ENCRYPTION_KEY || "").trim()
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(
      "SPEED_CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  return Buffer.from(hex, "hex")
}

export type EncryptedSpeedCredential = {
  encryptedPassword: string
  encryptionIv: string
  encryptionAuthTag: string
}

export function encryptSpeedAccountPassword(plaintext: string): EncryptedSpeedCredential {
  const key = loadSpeedCredentialEncryptionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    encryptedPassword: encrypted.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionAuthTag: authTag.toString("base64"),
  }
}

export function decryptSpeedAccountPassword(input: EncryptedSpeedCredential): string {
  const key = loadSpeedCredentialEncryptionKey()
  const iv = Buffer.from(input.encryptionIv, "base64")
  const authTag = Buffer.from(input.encryptionAuthTag, "base64")
  const encrypted = Buffer.from(input.encryptedPassword, "base64")
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}
