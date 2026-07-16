import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { listTerminalReadersEngine } from "@/engine/stripeTerminal"

export async function GET(req: NextRequest) {
  try { return NextResponse.json({ readers: await listTerminalReadersEngine((await requireStripeCardMerchant(req)).merchantId, { refresh: true }) }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Reader request failed" }, { status: getRouteErrorStatus(error) }) }
}
