import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

export type MerchantPublicKey = {
  id: string
  merchant_id: string
  name: string | null
  key_prefix: string
  key_hash: string
  allowed_origins: string[]
  enabled: boolean
  last_used_at: string | null
  created_at: string
}

export async function insertMerchantPublicKey(input: {
  id: string
  merchant_id: string
  name?: string | null
  key_prefix: string
  key_hash: string
}): Promise<MerchantPublicKey> {
  const { data, error } = await supabase
    .from("merchant_public_keys")
    .insert({
      id: input.id,
      merchant_id: input.merchant_id,
      name: input.name ?? null,
      key_prefix: input.key_prefix,
      key_hash: input.key_hash,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create public key: ${error.message}`)
  return data as MerchantPublicKey
}

export async function getMerchantPublicKeys(merchantId: string): Promise<MerchantPublicKey[]> {
  const { data, error } = await supabase
    .from("merchant_public_keys")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("enabled", true)
    .order("created_at", { ascending: false })

  if (error) throw new Error(`Failed to fetch public keys: ${error.message}`)
  return (data ?? []) as MerchantPublicKey[]
}

export async function getMerchantPublicKeyByPrefix(prefix: string): Promise<MerchantPublicKey | null> {
  const { data, error } = await supabase
    .from("merchant_public_keys")
    .select("*")
    .eq("key_prefix", prefix)
    .eq("enabled", true)
    .maybeSingle()

  if (error) throw new Error(`Failed to look up public key: ${error.message}`)
  return (data ?? null) as MerchantPublicKey | null
}

export async function disableMerchantPublicKey(id: string, merchantId: string): Promise<void> {
  const { error } = await supabase
    .from("merchant_public_keys")
    .update({ enabled: false })
    .eq("id", id)
    .eq("merchant_id", merchantId)

  if (error) throw new Error(`Failed to disable public key: ${error.message}`)
}

export async function touchMerchantPublicKeyLastUsed(id: string): Promise<void> {
  await supabase
    .from("merchant_public_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id)
}
