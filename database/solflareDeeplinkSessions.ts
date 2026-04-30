import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type SolflareDeeplinkSession = {
  id?: string
  flow_id: string
  payment_id: string
  intent_id?: string | null
  selected_asset: string
  dapp_public_key: string
  dapp_secret_key: number[]
  solflare_session?: string | null
  solflare_wallet_public_key?: string | null
  solflare_encryption_public_key?: string | null
  created_at?: string
  updated_at?: string
  consumed_at?: string | null
}

function normalizeSecretKey(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      return normalizeSecretKey(parsed)
    } catch {
      return []
    }
  }

  return []
}

function normalizeRecord(record: Record<string, unknown>): SolflareDeeplinkSession {
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    flow_id: String(record.flow_id || ""),
    payment_id: String(record.payment_id || ""),
    intent_id: record.intent_id ? String(record.intent_id) : null,
    selected_asset: String(record.selected_asset || "SOL"),
    dapp_public_key: String(record.dapp_public_key || ""),
    dapp_secret_key: normalizeSecretKey(record.dapp_secret_key),
    solflare_session: record.solflare_session ? String(record.solflare_session) : null,
    solflare_wallet_public_key: record.solflare_wallet_public_key
      ? String(record.solflare_wallet_public_key)
      : null,
    solflare_encryption_public_key: record.solflare_encryption_public_key
      ? String(record.solflare_encryption_public_key)
      : null,
    created_at: record.created_at ? String(record.created_at) : undefined,
    updated_at: record.updated_at ? String(record.updated_at) : undefined,
    consumed_at: record.consumed_at ? String(record.consumed_at) : null,
  }
}

export async function createSolflareDeeplinkSession(input: {
  flow_id: string
  payment_id: string
  intent_id?: string | null
  selected_asset: string
  dapp_public_key: string
  dapp_secret_key: number[]
}): Promise<SolflareDeeplinkSession> {
  const { data, error } = await db
    .from("solflare_deeplink_sessions")
    .insert({
      flow_id: input.flow_id,
      payment_id: input.payment_id,
      intent_id: input.intent_id || null,
      selected_asset: input.selected_asset,
      dapp_public_key: input.dapp_public_key,
      dapp_secret_key: input.dapp_secret_key,
    })
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to create Solflare deeplink session: ${error.message}`)
  }

  return normalizeRecord(data as Record<string, unknown>)
}

export async function getSolflareDeeplinkSessionByFlowId(
  flowId: string,
): Promise<SolflareDeeplinkSession | null> {
  const normalizedFlowId = String(flowId || "").trim()
  if (!normalizedFlowId) return null

  const { data, error } = await db
    .from("solflare_deeplink_sessions")
    .select("*")
    .eq("flow_id", normalizedFlowId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch Solflare deeplink session: ${error.message}`)
  }

  return data ? normalizeRecord(data as Record<string, unknown>) : null
}

export async function storeSolflareConnectSession(input: {
  flow_id: string
  solflare_session: string
  solflare_wallet_public_key: string
  solflare_encryption_public_key: string
}): Promise<void> {
  const { error } = await db
    .from("solflare_deeplink_sessions")
    .update({
      solflare_session: input.solflare_session,
      solflare_wallet_public_key: input.solflare_wallet_public_key,
      solflare_encryption_public_key: input.solflare_encryption_public_key,
      updated_at: new Date().toISOString(),
    })
    .eq("flow_id", input.flow_id)

  if (error) {
    throw new Error(`Failed to store Solflare connect session: ${error.message}`)
  }
}

export async function consumeSolflareDeeplinkSession(flowId: string): Promise<void> {
  const { error } = await db
    .from("solflare_deeplink_sessions")
    .update({
      consumed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("flow_id", flowId)

  if (error) {
    throw new Error(`Failed to consume Solflare deeplink session: ${error.message}`)
  }
}