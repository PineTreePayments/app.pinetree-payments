import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { createTerminalLocationEngine, listTerminalLocationsEngine } from "@/engine/stripeTerminal"

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Terminal location request failed" }, { status: getRouteErrorStatus(error) })
}

export async function GET(req: NextRequest) {
  try { return NextResponse.json({ locations: await listTerminalLocationsEngine((await requireStripeCardMerchant(req)).merchantId, { refresh: true }) }) }
  catch (error) { return errorResponse(error) }
}

export async function POST(req: NextRequest) {
  try {
    const { merchantId } = await requireStripeCardMerchant(req)
    const body = await req.json()
    return NextResponse.json({ location: await createTerminalLocationEngine(merchantId, { displayName: body.displayName, address: body.address }) })
  } catch (error) { return errorResponse(error) }
}
