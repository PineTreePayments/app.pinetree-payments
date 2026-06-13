import {
  insertMerchantApiKey,
  getMerchantApiKeys,
  getMerchantApiKeyByPrefix,
  revokeMerchantApiKey,
  touchMerchantApiKeyLastUsed,
  type ApiKeyPermission,
  type MerchantApiKey,
} from "@/database/merchantApiKeys"

export type { ApiKeyPermission }

// Prefix stored in DB: "pt_live_" + first PREFIX_SUFFIX_LENGTH hex chars of the random bytes
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

export type CreatedApiKey = {
  id: string
  name: string | null
  key: string
  prefix: string
  permissions: ApiKeyPermission[]
  createdAt: string
}

export type ApiKeyListItem = {
  id: string
  name: string | null
  prefix: string
  permissions: ApiKeyPermission[]
  lastUsedAt: string | null
  createdAt: string
}

export type VerifiedApiKey = {
  merchantId: string
  keyId: string
  permissions: ApiKeyPermission[]
}

const DEFAULT_PERMISSIONS: ApiKeyPermission[] = [
  "checkout.sessions:create",
  "checkout.sessions:read",
  "checkout.sessions:write",
  "payments:read",
  "checkout.links:create",
  "webhooks:read",
  "webhooks:write",
]

export async function createMerchantApiKey(input: {
  merchantId: string
  name?: string
  permissions?: ApiKeyPermission[]
}): Promise<CreatedApiKey> {
  const raw = generateRawHex()
  const plaintext = `pt_live_${raw}`
  const prefix = `pt_live_${raw.slice(0, PREFIX_SUFFIX_LENGTH)}`
  const keyHash = await hashKey(plaintext)
  const id = crypto.randomUUID()
  const permissions = input.permissions ?? DEFAULT_PERMISSIONS

  const record: MerchantApiKey = await insertMerchantApiKey({
    id,
    merchant_id: input.merchantId,
    name: input.name?.trim() || null,
    key_prefix: prefix,
    key_hash: keyHash,
    permissions,
  })

  return {
    id: record.id,
    name: record.name,
    key: plaintext,
    prefix,
    permissions,
    createdAt: record.created_at,
  }
}

export async function listMerchantApiKeys(merchantId: string): Promise<ApiKeyListItem[]> {
  const keys = await getMerchantApiKeys(merchantId)
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.key_prefix,
    permissions: k.permissions,
    lastUsedAt: k.last_used_at,
    createdAt: k.created_at,
  }))
}

export async function revokeMerchantApiKeyEngine(id: string, merchantId: string): Promise<void> {
  await revokeMerchantApiKey(id, merchantId)
}

export async function verifyMerchantApiKey(
  token: string,
  requiredPermission?: ApiKeyPermission
): Promise<VerifiedApiKey | null> {
  if (!token.startsWith("pt_live_")) return null

  // Extract prefix: "pt_live_" (8 chars) + PREFIX_SUFFIX_LENGTH hex chars
  const prefix = token.slice(0, 8 + PREFIX_SUFFIX_LENGTH)
  const keyRecord = await getMerchantApiKeyByPrefix(prefix)
  if (!keyRecord) return null

  const provided = await hashKey(token)
  if (provided !== keyRecord.key_hash) return null

  if (requiredPermission && !keyRecord.permissions.includes(requiredPermission)) return null

  // Fire-and-forget — don't block the auth path on a write
  void touchMerchantApiKeyLastUsed(keyRecord.id)

  return {
    merchantId: keyRecord.merchant_id,
    keyId: keyRecord.id,
    permissions: keyRecord.permissions,
  }
}
