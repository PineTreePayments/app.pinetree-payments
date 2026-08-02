import { createHash } from "node:crypto"
import { supabaseAdmin } from "./supabase"

function db() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Shift4 tokenization sessions require service-role database access")
  return supabaseAdmin
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

export async function createShift4TokenizationSession(input: {
  sessionId: string
  merchantId: string
  paymentId: string
  merchantProviderConnectionId: string
  completionSecret: string
  expiresAt: string
}): Promise<void> {
  const { error } = await db().from("shift4_tokenization_sessions").insert({
    session_id: input.sessionId,
    merchant_id: input.merchantId,
    payment_id: input.paymentId,
    merchant_provider_connection_id: input.merchantProviderConnectionId,
    completion_secret_hash: digest(input.completionSecret),
    status: "created",
    expires_at: input.expiresAt,
  })
  if (error) throw new Error(`Failed to create Shift4 tokenization session: ${error.message}`)
}

export type Shift4TokenizationSessionRow = {
  session_id: string
  merchant_id: string
  payment_id: string
  merchant_provider_connection_id: string
  status: "created" | "consumed" | "expired"
  expires_at: string
}

export async function getShift4TokenizationSession(
  merchantId: string,
  sessionId: string
): Promise<Shift4TokenizationSessionRow | null> {
  const { data, error } = await db().from("shift4_tokenization_sessions")
    .select("session_id, merchant_id, payment_id, merchant_provider_connection_id, status, expires_at")
    .eq("merchant_id", merchantId).eq("session_id", sessionId).maybeSingle()
  if (error) throw new Error(`Failed to load Shift4 tokenization session: ${error.message}`)
  return (data ?? null) as Shift4TokenizationSessionRow | null
}

export async function consumeShift4TokenizationSession(input: {
  sessionId: string
  merchantId: string
  completionSecret: string
  cardToken: string
}): Promise<"consumed_now" | "already_consumed" | "unavailable"> {
  const { data, error } = await db().rpc("consume_shift4_tokenization_session", {
    p_session_id: input.sessionId,
    p_merchant_id: input.merchantId,
    p_completion_secret_hash: digest(input.completionSecret),
    p_token_fingerprint: digest(input.cardToken).slice(0, 24),
  })
  if (error) throw new Error(`Failed to consume Shift4 tokenization session: ${error.message}`)
  return data === "consumed_now" || data === "already_consumed" ? data : "unavailable"
}
