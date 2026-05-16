import { NextRequest, NextResponse } from "next/server"
import { hasProviderConnected } from "@/database/merchants"
import { getMerchantAvailableNetworks } from "@/engine/paymentIntents"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const merchantId = String(searchParams.get("merchantId") || "").trim()

    if (!merchantId) {
      return NextResponse.json({ error: "Missing merchantId" }, { status: 400 })
    }

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
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
