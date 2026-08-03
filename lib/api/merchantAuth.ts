import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { verifyMerchantApiKey, type ApiKeyPermission } from "@/engine/merchantApiKeys"

type ErrorWithStatus = Error & { status?: number }
type MerchantRequestAuth = {
  merchantId: string
  authUserId: string
  email: string | null
  /**
   * The account's PRIMARY email, and only when Supabase has confirmed it.
   *
   * Deliberately separate from `email`, which falls back to user metadata that
   * the account holder can set freely. Any authorization decision keyed on an
   * address must use this field, never `email`.
   */
  verifiedEmail: string | null
  source: "api_key" | "supabase"
}

function createStatusError(message: string, status: number): ErrorWithStatus {
  const error: ErrorWithStatus = new Error(message)
  error.status = status
  return error
}

export function getRouteErrorStatus(error: unknown, fallback = 500) {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as ErrorWithStatus).status
    if (typeof status === "number") return status
  }
  return fallback
}

/**
 * Resolves merchant ID from an incoming request.
 *
 * Accepts two token formats in the Authorization: Bearer header:
 *  - "pt_live_..." → merchant API key (verified by hash + prefix lookup)
 *  - anything else → Supabase session JWT (verified via getUser)
 *
 * When requiredPermission is provided, it is checked for API keys only
 * (dashboard session tokens are always considered fully-privileged).
 */
export async function requireMerchantIdFromRequest(
  req: NextRequest,
  requiredPermission?: ApiKeyPermission
): Promise<string> {
  return (await requireMerchantAuthFromRequest(req, requiredPermission)).merchantId
}

export async function requireMerchantAuthFromRequest(
  req: NextRequest,
  requiredPermission?: ApiKeyPermission
): Promise<MerchantRequestAuth> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""

  if (!token) {
    throw createStatusError("Missing bearer token", 401)
  }

  // ── Merchant API key path ─────────────────────────────────────────────────
  if (token.startsWith("pt_live_")) {
    const verified = await verifyMerchantApiKey(token, requiredPermission)
    if (!verified) {
      throw createStatusError("Invalid or revoked API key", 401)
    }
    // An API key carries no human identity, so it can never satisfy an
    // email-based authorization check.
    return {
      merchantId: verified.merchantId,
      authUserId: verified.merchantId,
      email: null,
      verifiedEmail: null,
      source: "api_key",
    }
  }

  // ── Supabase session path ─────────────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw createStatusError("Missing Supabase env vars", 500)
  }

  const client = createClient(supabaseUrl, supabaseAnonKey)
  const { data: authData, error } = await client.auth.getUser(token)

  if (error || !authData?.user) {
    throw createStatusError("Unauthorized", 401)
  }

  const metadata = authData.user.user_metadata as Record<string, unknown> | undefined
  const email = String(
    authData.user.email ||
    metadata?.email ||
    metadata?.email_address ||
    ""
  ).trim().toLowerCase() || null

  // Only the provider-confirmed primary address counts as verified. An
  // unconfirmed or metadata-supplied address yields null, so an authorization
  // check keyed on it fails closed.
  const primaryEmail = String(authData.user.email || "").trim().toLowerCase()
  const verifiedEmail =
    primaryEmail && authData.user.email_confirmed_at ? primaryEmail : null

  return {
    merchantId: authData.user.id,
    authUserId: authData.user.id,
    email,
    verifiedEmail,
    source: "supabase",
  }
}
