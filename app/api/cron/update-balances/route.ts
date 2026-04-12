import { NextResponse } from "next/server"
import { refreshAllWalletBalancesEngine } from "@/engine/walletOverview"

export async function GET() {
  try {
    const result = await refreshAllWalletBalancesEngine()

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("Cron fatal error:", message)

    return NextResponse.json({
      success: false,
      error: message
    })
  }
}