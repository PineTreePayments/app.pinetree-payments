import { NextRequest, NextResponse } from "next/server"
import { previewPosBreakdownEngine } from "@/engine/posPayments"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const merchantId = String(searchParams.get("merchantId") || "").trim()
    const amount = Number(searchParams.get("amount") || 0)

    if (!merchantId) {
      return NextResponse.json({ error: "Missing merchantId" }, { status: 400 })
    }

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
    }

    const breakdown = await previewPosBreakdownEngine(merchantId, amount)
    return NextResponse.json(breakdown)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    const status = (err as Error & { status?: number }).status || 500
    return NextResponse.json({ error: message }, { status })
  }
}
