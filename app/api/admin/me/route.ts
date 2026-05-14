import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { supabase, supabaseAdmin } from "@/database/supabase"

const db = supabaseAdmin || supabase

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const { data } = await db
      .from("merchants")
      .select("email, role")
      .eq("id", merchantId)
      .single()

    return NextResponse.json({
      isAdmin: data?.role === "admin",
      merchantId,
      email: data?.email ?? null,
      role: data?.role ?? null,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
