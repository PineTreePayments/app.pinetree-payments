import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import {
  getPaymentIncompleteEligibility,
  markPaymentIncomplete
} from "@/engine/paymentStateActions"
import { supabase, supabaseAdmin } from "@/database/supabase"

const db = supabaseAdmin || supabase

const CONFIRM_TOKEN = "MARK_STALE_INCOMPLETE"
const MAX_IDS = 50
const MIN_PENDING_AGE_MS = 60 * 60_000
const MIN_CREATED_AGE_MS = 30 * 60_000

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
      .select("id, status")
      .in("id", paymentIds)

    if (error) {
      return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 })
    }

    const changed: Array<{ paymentId: string; previousStatus: string }> = []
    const skipped: Array<{ paymentId: string; status: string; reason: string }> = []
    const found = new Set((data || []).map((row: { id: string }) => row.id))

    for (const id of paymentIds) {
      if (!found.has(id)) {
        skipped.push({ paymentId: id, status: "NOT_FOUND", reason: "payment_not_found" })
      }
    }

    for (const row of (data || []) as Array<{ id: string; status: string }>) {
      const minimumAgeMs = row.status === "CREATED"
        ? MIN_CREATED_AGE_MS
        : MIN_PENDING_AGE_MS
      const eligibility = await getPaymentIncompleteEligibility(row.id, { minimumAgeMs })

      if (!eligibility.eligible) {
        skipped.push({
          paymentId: row.id,
          status: eligibility.status,
          reason: eligibility.reason
        })
        continue
      }

      try {
        const didChange = await markPaymentIncomplete(row.id, {
          providerEvent: "admin.stale-cleanup",
          rawPayload: {
            adminAction: true,
            reason: eligibility.reason,
            adminId,
            requestIp: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
          },
          minimumAgeMs
        })

        if (didChange) {
          changed.push({ paymentId: row.id, previousStatus: row.status })
        } else {
          skipped.push({ paymentId: row.id, status: row.status, reason: "eligibility_changed" })
        }
      } catch (updateErr) {
        const message = updateErr instanceof Error ? updateErr.message : "unknown error"
        skipped.push({ paymentId: row.id, status: row.status, reason: `update_failed: ${message}` })
      }
    }

    console.log("[admin/stale-payments/mark-incomplete] mutation complete", {
      changed: changed.length,
      skipped: skipped.length
    })

    return NextResponse.json({ changed, skipped })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/stale-payments/mark-incomplete] error", { status, message })
    return NextResponse.json({ error: message }, { status })
  }
}
