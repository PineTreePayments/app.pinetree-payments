import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { supabase, supabaseAdmin } from "@/database/supabase"
import { getPaymentIncompleteEligibility } from "@/engine/paymentStateActions"

const db = supabaseAdmin || supabase

const MAX_IDS = 100
const MIN_PENDING_AGE_MS = 60 * 60_000
const MIN_CREATED_AGE_MS = 30 * 60_000

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
      .select("id, status")
      .in("id", paymentIds)

    if (error) {
      return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 })
    }

    const eligible: Array<{ paymentId: string; status: string; staleReason: string }> = []
    const ineligible: Array<{ paymentId: string; status: string; staleReason: string }> = []
    const found = new Set((data || []).map((row: { id: string }) => row.id))

    for (const id of paymentIds) {
      if (!found.has(id)) {
        ineligible.push({ paymentId: id, status: "NOT_FOUND", staleReason: "payment_not_found" })
      }
    }

    for (const row of (data || []) as Array<{ id: string; status: string }>) {
      const minimumAgeMs = row.status === "CREATED"
        ? MIN_CREATED_AGE_MS
        : MIN_PENDING_AGE_MS
      const result = await getPaymentIncompleteEligibility(row.id, { minimumAgeMs })
      const target = result.eligible ? eligible : ineligible
      target.push({
        paymentId: row.id,
        status: result.status,
        staleReason: result.reason
      })
    }

    return NextResponse.json({ eligible, ineligible, previewOnly: true })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/stale-payments/preview] error", { status, message })
    return NextResponse.json({ error: message }, { status })
  }
}
