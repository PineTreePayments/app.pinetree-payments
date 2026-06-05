import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { getCheckoutLinkById } from "@/database/checkoutLinks"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"

const supabase = supabaseAdmin || supabaseAnon

// Resolved status exposed to API callers — decoupled from internal DB status strings.
type SessionStatus = "active" | "processing" | "paid" | "expired" | "canceled"

type PaymentIntentRow = {
  payment_id: string | null
}

type PaymentRow = {
  status: string
  updated_at: string
}

function buildCheckoutUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || "https://app.pinetree-payments.com"
  return `${base}/checkout/${encodeURIComponent(token)}`
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })
    }

    // API key callers need checkout.sessions:create (same permission used to create sessions).
    // JWT callers (dashboard) are always permitted.
    const merchantId = await requireMerchantIdFromRequest(req, "checkout.sessions:create")

    const link = await getCheckoutLinkById(sessionId, merchantId)
    if (!link) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    // ── Resolve base link status ─────────────────────────────────────────────
    let linkStatus: "active" | "disabled" | "expired" = link.status
    if (linkStatus === "active" && link.expires_at && new Date(link.expires_at) < new Date()) {
      linkStatus = "expired"
    }

    // ── Check for confirmed or in-progress payment ───────────────────────────
    // Find payment_intents created when a customer visited this checkout link.
    // The intent's metadata.checkoutLinkId references the link UUID.
    const { data: intentRows } = await supabase
      .from("payment_intents")
      .select("payment_id")
      .eq("merchant_id", merchantId)
      .filter("metadata->>checkoutLinkId", "eq", sessionId)
      .not("payment_id", "is", null) as { data: PaymentIntentRow[] | null }

    let sessionStatus: SessionStatus
    let paidAt: string | undefined

    if (intentRows && intentRows.length > 0) {
      const paymentIds = intentRows
        .map((r) => r.payment_id)
        .filter((id): id is string => Boolean(id))

      const { data: paymentRows } = await supabase
        .from("payments")
        .select("status, updated_at")
        .in("id", paymentIds) as { data: PaymentRow[] | null }

      const confirmed = (paymentRows ?? []).find((p) => p.status === "CONFIRMED")
      if (confirmed) {
        sessionStatus = "paid"
        paidAt = confirmed.updated_at
      } else {
        const inProgress = (paymentRows ?? []).some((p) =>
          ["CREATED", "PENDING", "PROCESSING"].includes(p.status)
        )
        if (inProgress) {
          sessionStatus = "processing"
        } else if (linkStatus === "disabled") {
          sessionStatus = "canceled"
        } else if (linkStatus === "expired") {
          sessionStatus = "expired"
        } else {
          sessionStatus = "active"
        }
      }
    } else {
      if (linkStatus === "disabled") {
        sessionStatus = "canceled"
      } else if (linkStatus === "expired") {
        sessionStatus = "expired"
      } else {
        sessionStatus = "active"
      }
    }

    const orderId = link.reference ?? (link.link_metadata as Record<string, unknown> | null)?.orderId as string | undefined

    return NextResponse.json({
      sessionId: link.id,
      token: link.public_token,
      amount: Number(link.amount),
      currency: link.currency,
      status: sessionStatus,
      orderId: orderId ?? null,
      checkoutUrl: buildCheckoutUrl(link.public_token),
      expiresAt: link.expires_at ?? null,
      ...(paidAt ? { paidAt } : {}),
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch session" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
