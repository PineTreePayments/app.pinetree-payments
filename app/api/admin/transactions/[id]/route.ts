import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAdminTransaction } from "@/database/adminTransactions"
import { supabase, supabaseAdmin } from "@/database/supabase"

const db = supabaseAdmin || supabase

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    await requireAdminFromRequest(req)

    const safeId = String(id || "").trim()
    if (!safeId) {
      return NextResponse.json({ error: "Missing payment ID" }, { status: 400 })
    }

    const [payment, eventsResult] = await Promise.all([
      getAdminTransaction(safeId),
      db
        .from("payment_events")
        .select("id, event_type, provider_event, created_at")
        .eq("payment_id", safeId)
        .order("created_at", { ascending: true }),
    ])

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    }

    return NextResponse.json({
      payment,
      events: eventsResult.data || [],
    })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/transactions/id] error", { status, message })
    return NextResponse.json({ error: message }, { status })
  }
}
