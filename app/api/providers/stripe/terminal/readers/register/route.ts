import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { registerTerminalReaderEngine } from "@/engine/stripeTerminal"

export async function POST(req: NextRequest) {
  try {
    const { merchantId } = await requireStripeCardMerchant(req)
    const body = await req.json()
    const reader = await registerTerminalReaderEngine(merchantId, { registrationCode: body.registrationCode, label: body.label, terminalLocationId: body.terminalLocationId })
    return NextResponse.json({ reader })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Reader registration failed" }, { status: getRouteErrorStatus(error) }) }
}
