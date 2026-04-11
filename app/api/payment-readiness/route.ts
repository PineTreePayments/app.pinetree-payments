import { NextRequest, NextResponse } from "next/server"
import { getPaymentReadinessEngine } from "@/engine/paymentReadiness"

export async function GET(req: NextRequest) {
  try {
    const merchantId = String(req.nextUrl.searchParams.get("merchantId") || "").trim() || undefined
    const readiness = await getPaymentReadinessEngine({ merchantId })

    return NextResponse.json({ success: true, ...readiness })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load payment readiness"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
