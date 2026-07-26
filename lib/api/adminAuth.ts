import { NextRequest } from "next/server"
import {
  requireMerchantAuthFromRequest,
  getRouteErrorStatus
} from "./merchantAuth"
import { supabase, supabaseAdmin } from "@/database/supabase"
import { isAdminRole, normalizeAdminRole } from "@/lib/adminAccess"

export { getRouteErrorStatus }

const db = supabaseAdmin || supabase

type AdminStatus = {
  isAdmin: boolean
  merchantId: string
  email: string | null
  role: string | null
}

function forbidden(): Error & { status?: number } {
  const error = new Error("Forbidden: admin access required") as Error & { status?: number }
  error.status = 403
  return error
}

export async function getAdminStatusFromRequest(req: NextRequest): Promise<AdminStatus> {
  const auth = await requireMerchantAuthFromRequest(req)

  if (auth.source !== "supabase") {
    return {
      isAdmin: false,
      merchantId: auth.merchantId,
      email: null,
      role: null,
    }
  }

  const { data } = await db
    .from("merchants")
    .select("email, role")
    .eq("id", auth.merchantId)
    .single()

  const role = normalizeAdminRole(data?.role)

  return {
    isAdmin: Boolean(data && isAdminRole(role)),
    merchantId: auth.merchantId,
    email: auth.email,
    role,
  }
}

export async function requireAdminFromRequest(req: NextRequest): Promise<string> {
  const status = await getAdminStatusFromRequest(req)

  if (!status.isAdmin) {
    throw forbidden()
  }

  return status.merchantId
}
