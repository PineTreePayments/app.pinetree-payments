import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireTrustedNativeMerchant } from "@/lib/api/stripeTerminalAuth"
import { createTerminalConnectionTokenEngine } from "@/engine/stripeTerminal"

export async function POST(req: NextRequest) {
  try {
    const { merchantId } = await requireTrustedNativeMerchant(req)
    return NextResponse.json(await createTerminalConnectionTokenEngine(merchantId), { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Connection token request failed" }, { status: getRouteErrorStatus(error) }) }
}
