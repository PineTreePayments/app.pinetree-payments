import {
  insertMerchantPublicKey,
  getMerchantPublicKeys,
  getMerchantPublicKeyByPrefix,
  disableMerchantPublicKey,
  touchMerchantPublicKeyLastUsed,
  type MerchantPublicKey,
} from "@/database/merchantPublicKeys"

// Prefix stored in DB: "pk_live_" (8 chars) + first PREFIX_SUFFIX_LENGTH hex chars of random bytes.
// Browser public keys format: pk_live_<64-hex>. Safe to include in client-side code.
const PREFIX_SUFFIX_LENGTH = 12

async function hashKey(plaintext: string): Promise<string> {
  const enc = new TextEncoder()
  const encoded = enc.encode(plaintext)
  const buf = await crypto.subtle.digest("SHA-256", encoded.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function generateRawHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export type CreatedPublicKey = {
  id: string
  name: string | null
  key: string
  prefix: string
  createdAt: string
}

export type PublicKeyListItem = {
  id: string
  name: string | null
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

export type VerifiedPublicKey = {
  merchantId: string
  keyId: string
}

export async function createMerchantPublicKey(input: {
  merchantId: string
  name?: string
}): Promise<CreatedPublicKey> {
  const raw = generateRawHex()
  const plaintext = `pk_live_${raw}`
  const prefix = `pk_live_${raw.slice(0, PREFIX_SUFFIX_LENGTH)}`
  const keyHash = await hashKey(plaintext)
  const id = crypto.randomUUID()

  const record: MerchantPublicKey = await insertMerchantPublicKey({
    id,
    merchant_id: input.merchantId,
    name: input.name?.trim() || null,
    key_prefix: prefix,
    key_hash: keyHash,
  })

  return {
    id: record.id,
    name: record.name,
    key: plaintext,
    prefix,
    createdAt: record.created_at,
  }
}

export async function listMerchantPublicKeys(merchantId: string): Promise<PublicKeyListItem[]> {
  const keys = await getMerchantPublicKeys(merchantId)
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.key_prefix,
    lastUsedAt: k.last_used_at,
    createdAt: k.created_at,
  }))
}

export async function disableMerchantPublicKeyEngine(id: string, merchantId: string): Promise<void> {
  await disableMerchantPublicKey(id, merchantId)
}

export async function verifyMerchantPublicKey(token: string): Promise<VerifiedPublicKey | null> {
  if (!token.startsWith("pk_live_")) return null

  // Extract prefix: "pk_live_" (8 chars) + PREFIX_SUFFIX_LENGTH hex chars
  const prefix = token.slice(0, 8 + PREFIX_SUFFIX_LENGTH)
  const keyRecord = await getMerchantPublicKeyByPrefix(prefix)
  if (!keyRecord) return null

  const provided = await hashKey(token)
  if (provided !== keyRecord.key_hash) return null

  // Fire-and-forget — don't block the auth path on a write
  void touchMerchantPublicKeyLastUsed(keyRecord.id).catch((err) => {
    console.error("[public-key] touchLastUsed failed:", err)
  })

  return {
    merchantId: keyRecord.merchant_id,
    keyId: keyRecord.id,
  }
}
