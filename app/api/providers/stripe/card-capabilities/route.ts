import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { isTrustedNativeRequest, requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { getCardCaptureAvailabilityEngine } from "@/engine/stripeTerminal"

export async function GET(req: NextRequest) {
  try {
    const { merchantId } = await requireStripeCardMerchant(req)
    const trustedNative = isTrustedNativeRequest(req)
    return NextResponse.json(await getCardCaptureAvailabilityEngine(merchantId, { platform: trustedNative ? "native" : "browser", tapToPaySupportedDevice: false }))
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Card capabilities request failed" }, { status: getRouteErrorStatus(error) }) }
}
