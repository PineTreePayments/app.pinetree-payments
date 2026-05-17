import { NextRequest, NextResponse } from "next/server"
import { hasProviderConnected } from "@/database/merchants"
import { getMerchantAvailableNetworks } from "@/engine/paymentIntents"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireTerminalSession } from "@/lib/api/terminalAuth"

export async function GET(req: NextRequest) {
  try {
    const { mid: merchantId } = requireTerminalSession(req)

    const [cardEnabled, availableNetworks] = await Promise.all([
      hasProviderConnected(merchantId, "shift4"),
      getMerchantAvailableNetworks(merchantId),
    ])

    // Crypto is available if the merchant has at least one non-card crypto rail ready.
    // "shift4" is the hosted card network; every other network in availableNetworks is crypto.
    const cryptoEnabled = availableNetworks.some((n) => n !== "shift4")

    return NextResponse.json({
      cash: true,
      crypto: cryptoEnabled,
      card: cardEnabled,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
