import { NextRequest, NextResponse } from "next/server"
import { cancelPaymentIntentEngine } from "@/engine/paymentIntents"
import { verifyTerminalSession } from "@/lib/api/terminalAuth"
import { verifyCheckoutSession } from "@/lib/api/checkoutAuth"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { getPaymentIntentById } from "@/database/paymentIntents"

type Params = { params: Promise<{ intentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  // ── Auth: terminal session (POS) or merchant auth (dashboard/API) ──────────
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    let authorizedMerchantId: string | null = null
    if (token.startsWith("pts_")) {
      authorizedMerchantId = verifyTerminalSession(token).mid
    } else if (token.startsWith("pco_")) {
      const claims = verifyCheckoutSession(token)
      const { intentId } = await params
      if (claims.iid !== String(intentId || "").trim()) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    } else {
      authorizedMerchantId = await requireMerchantIdFromRequest(req)
    }

    if (authorizedMerchantId) {
      const { intentId } = await params
      const intent = await getPaymentIntentById(String(intentId || "").trim())
      if (!intent || intent.merchant_id !== authorizedMerchantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { intentId } = await params
    const id = String(intentId || "").trim()
    if (!id) {
      return NextResponse.json({ error: "Missing intent ID" }, { status: 400 })
    }
    await cancelPaymentIntentEngine(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel payment" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
