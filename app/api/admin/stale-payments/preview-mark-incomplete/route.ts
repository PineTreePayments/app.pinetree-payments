import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { supabase, supabaseAdmin } from "@/database/supabase"

const db = supabaseAdmin || supabase

const MAX_IDS = 100

export async function POST(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const body = (await req.json()) as { paymentIds?: unknown }
    const rawIds = Array.isArray(body.paymentIds) ? body.paymentIds : []
    const paymentIds = rawIds
      .map((id) => String(id || "").replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 36))
      .filter(Boolean)

    if (!paymentIds.length) {
      return NextResponse.json({ error: "paymentIds required" }, { status: 400 })
    }
    if (paymentIds.length > MAX_IDS) {
      return NextResponse.json({ error: `Max ${MAX_IDS} payment IDs per request` }, { status: 400 })
    }

    const { data, error } = await db
      .from("payments")
      .select("id, status, created_at")
      .in("id", paymentIds)

    if (error) {
      return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 })
    }

    const now = Date.now()
    const eligible: Array<{ paymentId: string; status: string; staleReason: string }> = []
    const ineligible: Array<{ paymentId: string; status: string; staleReason: string }> = []

    const found = new Set((data || []).map((r: { id: string }) => r.id))
    for (const id of paymentIds) {
      if (!found.has(id)) {
        ineligible.push({ paymentId: id, status: "NOT_FOUND", staleReason: "payment_not_found" })
      }
    }

    for (const row of (data || []) as Array<{ id: string; status: string; created_at: string }>) {
      const ageMinutes = (now - new Date(row.created_at).getTime()) / 60_000

      if (row.status === "PENDING" && ageMinutes >= 60) {
        eligible.push({ paymentId: row.id, status: row.status, staleReason: "pending_no_activity_timeout" })
      } else if (row.status === "CREATED" && ageMinutes >= 30) {
        // CREATED → INCOMPLETE is valid per state machine (validTransitions.CREATED includes INCOMPLETE)
        eligible.push({ paymentId: row.id, status: row.status, staleReason: "created_no_activity_timeout" })
      } else if (row.status === "PROCESSING") {
        ineligible.push({ paymentId: row.id, status: row.status, staleReason: "processing_requires_manual_review" })
      } else if (["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "REFUNDED"].includes(row.status)) {
        ineligible.push({ paymentId: row.id, status: row.status, staleReason: "terminal_status_not_eligible" })
      } else {
        ineligible.push({ paymentId: row.id, status: row.status, staleReason: "recent_payment_not_eligible" })
      }
    }

    return NextResponse.json({ eligible, ineligible, previewOnly: true })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/stale-payments/preview] error", { status, message })
    return NextResponse.json({ error: message }, { status })
  }
}
