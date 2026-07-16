import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { listTerminalReadersEngine } from "@/engine/stripeTerminal"

export async function GET(req: NextRequest) {
  try { return NextResponse.json({ readers: await listTerminalReadersEngine(await requireMerchantIdFromRequest(req), { refresh: true }) }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Reader request failed" }, { status: getRouteErrorStatus(error) }) }
}
