import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

type ErrorWithStatus = Error & { status?: number }

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

export async function requireMerchantIdFromRequest(req: NextRequest): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw createStatusError("Missing Supabase env vars", 500)
  }

  const authHeader = req.headers.get("authorization") || ""
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : ""

  if (!accessToken) {
    throw createStatusError("Missing bearer token", 401)
  }

  const client = createClient(supabaseUrl, supabaseAnonKey)
  const { data: authData, error } = await client.auth.getUser(accessToken)

  if (error || !authData?.user) {
    throw createStatusError("Unauthorized", 401)
  }

  return authData.user.id
}
