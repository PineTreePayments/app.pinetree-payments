import { NextRequest, NextResponse } from "next/server"
import { hasProviderConnected } from "@/database/merchants"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const merchantId = String(searchParams.get("merchantId") || "").trim()

    if (!merchantId) {
      return NextResponse.json({ error: "Missing merchantId" }, { status: 400 })
    }

    const cardEnabled = await hasProviderConnected(merchantId, "shift4")

    return NextResponse.json({
      cash: true,
      crypto: true,
      card: cardEnabled
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
