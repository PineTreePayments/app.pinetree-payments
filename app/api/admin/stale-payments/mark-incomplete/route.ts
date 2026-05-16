import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { updatePaymentStatus } from "@/engine/updatePaymentStatus"
import { supabase, supabaseAdmin } from "@/database/supabase"

const db = supabaseAdmin || supabase

const CONFIRM_TOKEN = "MARK_STALE_INCOMPLETE"
const MAX_IDS = 50
const MIN_PENDING_AGE_MINUTES = 60

export async function POST(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const body = (await req.json()) as { paymentIds?: unknown; confirm?: unknown }

    if (body.confirm !== CONFIRM_TOKEN) {
      return NextResponse.json(
        { error: `Must include confirm: "${CONFIRM_TOKEN}" to proceed` },
        { status: 400 }
      )
    }

    const rawIds = Array.isArray(body.paymentIds) ? body.paymentIds : []
    const paymentIds = rawIds
      .map((id) => String(id || "").replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 36))
      .filter(Boolean)

    if (!paymentIds.length) {
      return NextResponse.json({ error: "paymentIds required" }, { status: 400 })
    }
    if (paymentIds.length > MAX_IDS) {
      return NextResponse.json({ error: `Max ${MAX_IDS} payment IDs per mutation request` }, { status: 400 })
    }

    const { data, error } = await db
      .from("payments")
      .select("id, status, created_at")
      .in("id", paymentIds)

    if (error) {
      return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 })
    }

    const now = Date.now()
    const changed: Array<{ paymentId: string; previousStatus: string }> = []
    const skipped: Array<{ paymentId: string; status: string; reason: string }> = []

    const found = new Set((data || []).map((r: { id: string }) => r.id))
    for (const id of paymentIds) {
      if (!found.has(id)) {
        skipped.push({ paymentId: id, status: "NOT_FOUND", reason: "payment_not_found" })
      }
    }

    for (const row of (data || []) as Array<{ id: string; status: string; created_at: string }>) {
      // Only PENDING → INCOMPLETE is a valid state machine transition.
      // CREATED → INCOMPLETE and PROCESSING → INCOMPLETE are both invalid.
      if (row.status !== "PENDING") {
        const reason =
          row.status === "CREATED"
            ? "state_machine_prevents_created_incomplete"
            : row.status === "PROCESSING"
            ? "processing_requires_manual_review"
            : "terminal_status_not_eligible"
        skipped.push({ paymentId: row.id, status: row.status, reason })
        continue
      }

      const ageMinutes = (now - new Date(row.created_at).getTime()) / 60_000
      if (ageMinutes < MIN_PENDING_AGE_MINUTES) {
        skipped.push({ paymentId: row.id, status: row.status, reason: "recent_payment_not_eligible" })
        continue
      }

      try {
        await updatePaymentStatus(row.id, "INCOMPLETE", {
          providerEvent: "admin.stale-cleanup",
          rawPayload: { adminAction: true, reason: "pending_no_activity_timeout" },
        })
        changed.push({ paymentId: row.id, previousStatus: row.status })
      } catch (updateErr) {
        const msg = updateErr instanceof Error ? updateErr.message : "unknown error"
        skipped.push({ paymentId: row.id, status: row.status, reason: `update_failed: ${msg}` })
      }
    }

    console.log("[admin/stale-payments/mark-incomplete] mutation complete", {
      changed: changed.length,
      skipped: skipped.length,
    })

    return NextResponse.json({ changed, skipped })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/stale-payments/mark-incomplete] error", { status, message })
    return NextResponse.json({ error: message }, { status })
  }
}
