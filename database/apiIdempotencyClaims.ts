import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

export type ApiIdempotencyClaim = {
  id: string
  merchant_id: string
  route: string
  idempotency_key_hash: string
  request_hash: string
  resource_id: string | null
  response_body: Record<string, unknown> | null
  created_at: string
  expires_at: string | null
}

export async function claimApiIdempotency(input: {
  merchantId: string
  route: string
  keyHash: string
  requestHash: string
  expiresAt?: string
}): Promise<
  | { claimed: true; claim: ApiIdempotencyClaim }
  | { claimed: false; claim: ApiIdempotencyClaim }
> {
  const record = {
    id: crypto.randomUUID(),
    merchant_id: input.merchantId,
    route: input.route,
    idempotency_key_hash: input.keyHash,
    request_hash: input.requestHash,
    expires_at: input.expiresAt ?? null,
  }
  const { data, error } = await supabase
    .from("api_idempotency_claims")
    .insert(record)
    .select()
    .single()

  if (!error) return { claimed: true, claim: data as ApiIdempotencyClaim }
  if (error.code !== "23505") {
    throw new Error(`Failed to store API idempotency claim: ${error.message}`)
  }

  const existing = await getApiIdempotencyClaim(
    input.merchantId,
    input.route,
    input.keyHash
  )
  if (!existing) {
    throw new Error("Failed to load an existing API idempotency claim")
  }
  return { claimed: false, claim: existing }
}

export async function getApiIdempotencyClaim(
  merchantId: string,
  route: string,
  keyHash: string
): Promise<ApiIdempotencyClaim | null> {
  const { data, error } = await supabase
    .from("api_idempotency_claims")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("route", route)
    .eq("idempotency_key_hash", keyHash)
    .maybeSingle()

  if (error) throw new Error(`Failed to load API idempotency claim: ${error.message}`)
  return (data ?? null) as ApiIdempotencyClaim | null
}

export async function completeApiIdempotencyClaim(input: {
  claimId: string
  resourceId: string
  responseBody: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabase
    .from("api_idempotency_claims")
    .update({
      resource_id: input.resourceId,
      response_body: input.responseBody,
    })
    .eq("id", input.claimId)

  if (error) throw new Error(`Failed to complete API idempotency claim: ${error.message}`)
}

export async function releaseApiIdempotencyClaim(claimId: string): Promise<void> {
  const { error } = await supabase
    .from("api_idempotency_claims")
    .delete()
    .eq("id", claimId)
    .is("resource_id", null)

  if (error) throw new Error(`Failed to release API idempotency claim: ${error.message}`)
}

export async function deleteExpiredCompletedApiIdempotencyClaims(
  now = new Date().toISOString()
): Promise<number> {
  const { data, error } = await supabase
    .from("api_idempotency_claims")
    .delete()
    .lt("expires_at", now)
    .not("resource_id", "is", null)
    .not("response_body", "is", null)
    .select("id")

  if (error) throw new Error(`Failed to clean API idempotency claims: ${error.message}`)
  return data?.length ?? 0
}
