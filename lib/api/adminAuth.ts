import { NextRequest } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "./merchantAuth"
import { supabase, supabaseAdmin } from "@/database/supabase"

export { getRouteErrorStatus }

const db = supabaseAdmin || supabase

export async function requireAdminFromRequest(req: NextRequest): Promise<string> {
  const merchantId = await requireMerchantIdFromRequest(req)

  const { data } = await db
    .from("merchants")
    .select("role")
    .eq("id", merchantId)
    .single()

  if (!data || data.role !== "admin") {
    const error = new Error("Forbidden: admin access required") as Error & { status?: number }
    error.status = 403
    throw error
  }

  return merchantId
}
