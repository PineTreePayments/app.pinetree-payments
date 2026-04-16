import { NextRequest, NextResponse } from "next/server"
import { refreshAllWalletBalancesEngine } from "@/engine/walletOverview"

// Mirror the same CRON_SECRET guard used by /api/cron/check-payments.
// Set CRON_SECRET in Vercel env vars so only Vercel Cron (or an authorised
// caller) can trigger a full balance refresh. Without it, any unauthenticated
// request would cause N × RPC calls across all merchant wallets.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // open in dev when no secret is configured
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await refreshAllWalletBalancesEngine()
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[cron:update-balances] fatal error:", message)
    return NextResponse.json({ success: false, error: message })
  }
}
