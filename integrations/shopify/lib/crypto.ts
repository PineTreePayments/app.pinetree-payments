import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// AES-256-GCM token encryption for Shopify access tokens stored in
// shopify_connections. The key must be a 64-character hex string (32 bytes).
// Store it in SHOPIFY_TOKEN_ENCRYPTION_KEY — never hardcode it.
//
// Ciphertext format: "<iv_b64>.<ciphertext_b64>.<authTag_b64>"

const ALGORITHM = "aes-256-gcm" as const
const IV_BYTES  = 12  // 96-bit IV is the GCM recommendation

function loadKey(): Buffer {
  const hex = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ?? ""
  if (hex.length !== 64) {
    throw new Error(
      "SHOPIFY_TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  return Buffer.from(hex, "hex")
}

export function encryptShopifyToken(plaintext: string): string {
  const key    = loadKey()
  const iv     = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, encrypted, tag].map((b) => b.toString("base64")).join(".")
}

export function decryptShopifyToken(ciphertext: string): string {
  const key   = loadKey()
  const parts = ciphertext.split(".")
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format. Expected iv.ciphertext.authTag")
  }
  const [iv, encrypted, tag] = parts.map((p) => Buffer.from(p, "base64"))
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}
