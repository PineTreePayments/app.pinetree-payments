import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

export type ApiKeyPermission =
  | "checkout.sessions:create"
  | "checkout.sessions:read"
  | "checkout.sessions:write"
  | "payments:read"
  | "checkout.links:create"
  | "webhooks:read"
  | "webhooks:write"

export type MerchantApiKey = {
  id: string
  merchant_id: string
  name: string | null
  key_prefix: string
  key_hash: string
  permissions: ApiKeyPermission[]
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export async function insertMerchantApiKey(input: {
  id: string
  merchant_id: string
  name?: string | null
  key_prefix: string
  key_hash: string
  permissions: ApiKeyPermission[]
}): Promise<MerchantApiKey> {
  const { data, error } = await supabase
    .from("merchant_api_keys")
    .insert({
      id: input.id,
      merchant_id: input.merchant_id,
      name: input.name ?? null,
      key_prefix: input.key_prefix,
      key_hash: input.key_hash,
      permissions: input.permissions,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create API key: ${error.message}`)
  return data as MerchantApiKey
}

export async function getMerchantApiKeys(merchantId: string): Promise<MerchantApiKey[]> {
  const { data, error } = await supabase
    .from("merchant_api_keys")
    .select("*")
    .eq("merchant_id", merchantId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })

  if (error) throw new Error(`Failed to fetch API keys: ${error.message}`)
  return (data ?? []) as MerchantApiKey[]
}

export async function getMerchantApiKeyByPrefix(prefix: string): Promise<MerchantApiKey | null> {
  const { data, error } = await supabase
    .from("merchant_api_keys")
    .select("*")
    .eq("key_prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle()

  if (error) throw new Error(`Failed to look up API key: ${error.message}`)
  return (data ?? null) as MerchantApiKey | null
}

export async function revokeMerchantApiKey(id: string, merchantId: string): Promise<void> {
  const { error } = await supabase
    .from("merchant_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("merchant_id", merchantId)

  if (error) throw new Error(`Failed to revoke API key: ${error.message}`)
}

export async function touchMerchantApiKeyLastUsed(id: string): Promise<void> {
  await supabase
    .from("merchant_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id)
}
