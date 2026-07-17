import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { createSimulatedTerminalReaderEngine } from "@/engine/stripeTerminal"

export async function POST(req: NextRequest) {
  try {
    const { merchantId } = await requireStripeCardMerchant(req)
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ reader: await createSimulatedTerminalReaderEngine(merchantId, { terminalLocationId: body.terminalLocationId }) })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Simulated reader request failed" }, { status: getRouteErrorStatus(error) }) }
}
