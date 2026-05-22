import { NextRequest, NextResponse } from "next/server"
import { cancelPaymentIntentEngine } from "@/engine/paymentIntents"
import { verifyTerminalSession } from "@/lib/api/terminalAuth"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"

type Params = { params: Promise<{ intentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  // ── Auth: terminal session (POS) or merchant auth (dashboard/API) ──────────
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    if (token.startsWith("pts_")) {
      verifyTerminalSession(token) // throws on invalid/expired
    } else {
      await requireMerchantIdFromRequest(req) // throws on invalid/missing
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
