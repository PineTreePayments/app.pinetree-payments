/**
 * GET /api/wallets/settlement/balances?wallet_address=...&network=...
 *
 * Returns current native + USDC balance for a merchant's connected wallet.
 * Read-only — never initiates any transaction.
 * USDC balance is fetched live from chain via RPC; result is not cached.
 *
 * Supported networks: base, solana
 */

import { NextRequest, NextResponse } from "next/server"
import {
  requireMerchantIdFromRequest,
  getRouteErrorStatus
} from "@/lib/api/merchantAuth"
import {
  fetchBaseUsdcBalance,
  fetchSolanaUsdcBalance
} from "@/engine/settlementBalances"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let merchantId: string
  try {
    merchantId = await requireMerchantIdFromRequest(req)
  } catch (err) {
    return errorResponse("Unauthorized", getRouteErrorStatus(err))
  }

  // Suppress unused variable — merchantId is used for auth; address comes from query params
  void merchantId

  const url = new URL(req.url)
  const walletAddress = String(url.searchParams.get("wallet_address") || "").trim()
  const network       = String(url.searchParams.get("network")        || "").trim().toLowerCase()

  if (!walletAddress) return errorResponse("wallet_address is required", 400)
  if (!network)       return errorResponse("network is required", 400)

  if (network !== "base" && network !== "solana") {
    return errorResponse(`Unsupported network: ${network}. Supported: base, solana`, 400)
  }

  const refreshedAt = new Date().toISOString()

  let usdc: number | null = null
  let usdcError: string | undefined

  try {
    if (network === "base") {
      usdc = await fetchBaseUsdcBalance(walletAddress)
    } else {
      usdc = await fetchSolanaUsdcBalance(walletAddress)
    }
  } catch (err) {
    usdcError = err instanceof Error ? err.message : "Unable to refresh USDC balance right now."
    usdc = null
  }

  return NextResponse.json({
    success: true,
    network,
    walletAddress,
    usdc,
    usdcError: usdcError ?? null,
    refreshedAt
  })
}
