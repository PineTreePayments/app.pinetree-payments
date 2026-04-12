import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type WalletConnectSessionRecord = {
  session_id: string
  merchant_id?: string | null
  provider: string
  wallet_type?: string | null
  wallet_address?: string | null
  status?: string
  updated_at?: string
}

export async function getWalletConnectSessionById(sessionId: string) {
  const normalizedSessionId = String(sessionId || "").trim()
  if (!normalizedSessionId) {
    throw new Error("Missing session_id")
  }

  const { data, error } = await db
    .from("wallet_connection_sessions")
    .select("*")
    .eq("session_id", normalizedSessionId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch wallet connect session: ${error.message}`)
  }

  return data ?? null
}

export async function upsertWalletConnectSession(input: WalletConnectSessionRecord) {
  const normalizedSessionId = String(input.session_id || "").trim()
  const provider = String(input.provider || "").trim()

  if (!normalizedSessionId || !provider) {
    throw new Error("session_id and provider are required")
  }

  const { data, error } = await db
    .from("wallet_connection_sessions")
    .upsert(
      {
        session_id: normalizedSessionId,
        merchant_id: input.merchant_id || null,
        provider,
        wallet_type: input.wallet_type || null,
        wallet_address: input.wallet_address || null,
        status: String(input.status || "pending"),
        updated_at: input.updated_at || new Date().toISOString()
      },
      { onConflict: "session_id" }
    )
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to upsert wallet connect session: ${error.message}`)
  }

  return data
}

export async function deleteWalletConnectSession(sessionId: string) {
  const normalizedSessionId = String(sessionId || "").trim()
  if (!normalizedSessionId) {
    throw new Error("Missing session_id")
  }

  const { error } = await db
    .from("wallet_connection_sessions")
    .delete()
    .eq("session_id", normalizedSessionId)

  if (error) {
    throw new Error(`Failed to delete wallet connect session: ${error.message}`)
  }
}
