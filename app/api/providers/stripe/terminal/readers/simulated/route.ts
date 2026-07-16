import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { createSimulatedTerminalReaderEngine } from "@/engine/stripeTerminal"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ reader: await createSimulatedTerminalReaderEngine(merchantId, { terminalLocationId: body.terminalLocationId }) })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Simulated reader request failed" }, { status: getRouteErrorStatus(error) }) }
}
