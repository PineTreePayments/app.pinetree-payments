import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { getTerminalNativeConfigEngine } from "@/engine/stripeTerminal"

export async function GET(req: NextRequest) {
  try { const { merchantId } = await requireStripeCardMerchant(req); return NextResponse.json(await getTerminalNativeConfigEngine(merchantId)) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Native config request failed" }, { status: getRouteErrorStatus(error) }) }
}
