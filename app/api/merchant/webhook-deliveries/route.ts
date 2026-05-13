import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"

const supabase = supabaseAdmin || supabaseAnon

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const { data, error } = await supabase
      .from("webhook_deliveries")
      .select("id, event, status, response_status, attempt_count, created_at")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) throw new Error(error.message)

    return NextResponse.json({ deliveries: data ?? [] })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch webhook deliveries" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
