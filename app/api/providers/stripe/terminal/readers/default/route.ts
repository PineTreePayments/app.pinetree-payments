import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { setDefaultTerminalReaderEngine } from "@/engine/stripeTerminal"

export async function POST(req: NextRequest) {
  try {
    const { merchantId } = await requireStripeCardMerchant(req)
    const body = await req.json()
    return NextResponse.json({ readers: await setDefaultTerminalReaderEngine(merchantId, body.readerId) })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Default reader request failed" }, { status: getRouteErrorStatus(error) }) }
}
