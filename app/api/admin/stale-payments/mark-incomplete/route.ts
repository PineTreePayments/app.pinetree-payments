import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { updatePaymentStatus } from "@/engine/updatePaymentStatus"
import { supabase, supabaseAdmin } from "@/database/supabase"

const db = supabaseAdmin || supabase

const CONFIRM_TOKEN = "MARK_STALE_INCOMPLETE"
const MAX_IDS = 50
const MIN_PENDING_AGE_MINUTES = 60
const MIN_CREATED_AGE_MINUTES = 30

export async function POST(req: NextRequest) {
  try {
    const adminId = await requireAdminFromRequest(req)

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
      const ageMinutes = (now - new Date(row.created_at).getTime()) / 60_000

      // PROCESSING → INCOMPLETE is never allowed (processing payments may still confirm).
      // Terminal statuses are also excluded.
      if (row.status === "PROCESSING") {
        skipped.push({ paymentId: row.id, status: row.status, reason: "processing_requires_manual_review" })
        continue
      }
      if (!["CREATED", "PENDING"].includes(row.status)) {
        skipped.push({ paymentId: row.id, status: row.status, reason: "terminal_status_not_eligible" })
        continue
      }

      // Conservative age thresholds for the admin manual action.
      // The automated cron sweep uses the tighter 5-minute threshold.
      // CREATED → INCOMPLETE is a valid state machine transition (validTransitions.CREATED includes INCOMPLETE).
      const minAge = row.status === "CREATED" ? MIN_CREATED_AGE_MINUTES : MIN_PENDING_AGE_MINUTES
      if (ageMinutes < minAge) {
        skipped.push({ paymentId: row.id, status: row.status, reason: "recent_payment_not_eligible" })
        continue
      }

      const staleReason =
        row.status === "CREATED" ? "created_no_activity_timeout" : "pending_no_activity_timeout"

      try {
        await updatePaymentStatus(row.id, "INCOMPLETE", {
          providerEvent: "admin.stale-cleanup",
          rawPayload: {
            adminAction: true,
            reason: staleReason,
            adminId,
            requestIp: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
          },
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
