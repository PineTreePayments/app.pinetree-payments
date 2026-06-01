import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase
const TABLE = "merchant_exchange_connections"

export type MeshConnectionRecord = {
  id: string
  merchant_id: string
  provider: string
  institution_name: string | null
  institution_id: string | null
  mesh_integration_id: string | null
  mesh_account_id: string | null
  mesh_auth_token_id: string | null
  status: string
  created_at: string
  updated_at: string
  last_synced_at: string | null
}

export type CreateMeshConnectionInput = {
  merchantId: string
  provider?: string
  institutionName?: string | null
  institutionId?: string | null
  meshIntegrationId?: string | null
  meshAccountId?: string | null
  meshAuthTokenId?: string | null
  status?: string
}

function normalize(row: Record<string, unknown>): MeshConnectionRecord {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    provider: String(row.provider || "mesh"),
    institution_name: row.institution_name ? String(row.institution_name) : null,
    institution_id: row.institution_id ? String(row.institution_id) : null,
    mesh_integration_id: row.mesh_integration_id ? String(row.mesh_integration_id) : null,
    mesh_account_id: row.mesh_account_id ? String(row.mesh_account_id) : null,
    mesh_auth_token_id: row.mesh_auth_token_id ? String(row.mesh_auth_token_id) : null,
    status: String(row.status || "active"),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    last_synced_at: row.last_synced_at ? String(row.last_synced_at) : null
  }
}

export async function listMeshConnections(merchantId: string): Promise<MeshConnectionRecord[]> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(`Failed to list exchange connections: ${error.message}`)
  return ((data || []) as Record<string, unknown>[]).map(normalize)
}

export async function getMeshConnection(
  merchantId: string,
  id: string
): Promise<MeshConnectionRecord | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to get exchange connection: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function createMeshConnection(
  input: CreateMeshConnectionInput
): Promise<MeshConnectionRecord> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      provider: input.provider || "mesh",
      institution_name: input.institutionName?.trim() || null,
      institution_id: input.institutionId?.trim() || null,
      mesh_integration_id: input.meshIntegrationId?.trim() || null,
      mesh_account_id: input.meshAccountId?.trim() || null,
      mesh_auth_token_id: input.meshAuthTokenId?.trim() || null,
      status: input.status || "active",
      updated_at: now
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to create exchange connection: ${error?.message || "No data returned"}`)
  }
  return normalize(data as Record<string, unknown>)
}

export async function updateMeshConnectionSyncedAt(
  merchantId: string,
  id: string
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .from(TABLE)
    .update({ last_synced_at: now, updated_at: now })
    .eq("merchant_id", merchantId)
    .eq("id", id)
}
