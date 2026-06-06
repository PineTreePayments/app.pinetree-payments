import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"

const supabase = supabaseAdmin || supabaseAnon

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req, "webhooks:read")

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "50")), 100)
    const before = searchParams.get("before") // ISO timestamp cursor for pagination

    // Fetch `payload` so we can surface the `_test` flag in the response.
    // Test deliveries have `_test: true` at the top level of their payload JSONB.
    let query = supabase
      .from("webhook_deliveries")
      .select("id, event, status, response_status, attempt_count, created_at, payload")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (before) {
      query = query.lt("created_at", before)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    type RawRow = {
      id: string
      event: string
      status: string
      response_status: number | null
      attempt_count: number
      created_at: string
      payload: Record<string, unknown> | null
    }

    const rows = (data ?? []) as RawRow[]
    const deliveries = rows.map((row) => ({
      id: row.id,
      event: row.event,
      status: row.status,
      response_status: row.response_status,
      attempt_count: row.attempt_count,
      created_at: row.created_at,
      is_test: row.payload?._test === true,
    }))

    const nextCursor =
      deliveries.length === limit
        ? deliveries[deliveries.length - 1].created_at
        : null

    return NextResponse.json({ deliveries, nextCursor })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch webhook deliveries" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
