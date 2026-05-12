import { NextRequest, NextResponse } from "next/server"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"
import { supabase, supabaseAdmin } from "@/database"
import { getMarketPricesUSD } from "@/engine/marketPrices"
import {
  getSpeedAccountBalanceDiagnostics,
  maskSpeedAccountId
} from "@/providers/lightning/getBalance"

const db = supabaseAdmin || supabase

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { data, error } = await db
      .from("merchant_providers")
      .select("id, credentials")
      .eq("merchant_id", merchantId)
      .eq("provider", "lightning")
      .in("status", ["connected", "active"])
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to load Lightning provider: ${error.message}`)
    }

    const credentials = (data?.credentials || {}) as Record<string, unknown>
    const speedAccountId = String(credentials.speed_account_id || "").trim()
    const [diagnostics, prices] = await Promise.all([
      getSpeedAccountBalanceDiagnostics(speedAccountId),
      getMarketPricesUSD()
    ])
    const usdAmount = diagnostics.btcAmount * prices.BTC
    const finalWalletObject = data?.id ? {
      id: data.id,
      type: "bitcoin_lightning",
      provider: "Speed",
      status: "Connected",
      speedAccountIdMasked: maskSpeedAccountId(speedAccountId),
      asset: "BTC",
      network: "Bitcoin Lightning",
      nativeBalance: diagnostics.btcAmount,
      usdBalance: usdAmount
    } : null

    console.info("[lightning/debug-balance] result", {
      merchantId,
      speedAccountIdMasked: maskSpeedAccountId(speedAccountId),
      hasApiKey: diagnostics.hasApiKey,
      baseUrl: diagnostics.baseUrl,
      httpStatus: diagnostics.httpStatus,
      rawBalanceKeys: diagnostics.rawBalanceKeys,
      balancesFound: diagnostics.balancesFound,
      rawNumericAmount: diagnostics.rawNumericAmount,
      satsAmount: diagnostics.satsAmount,
      btcAmount: diagnostics.btcAmount,
      usdAmount,
      finalWalletObject,
      error: diagnostics.error
    })

    return NextResponse.json({
      hasApiKey: diagnostics.hasApiKey,
      baseUrl: diagnostics.baseUrl,
      speedAccountIdMasked: diagnostics.speedAccountIdMasked,
      httpStatus: diagnostics.httpStatus,
      balancesFound: diagnostics.balancesFound,
      rawBalanceKeys: diagnostics.rawBalanceKeys,
      satsAmount: diagnostics.satsAmount,
      btcAmount: diagnostics.btcAmount,
      usdAmount,
      finalWalletObject,
      error: diagnostics.error || null
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        hasApiKey: false,
        baseUrl: "",
        speedAccountIdMasked: "",
        httpStatus: null,
        balancesFound: [],
        rawBalanceKeys: [],
        satsAmount: 0,
        btcAmount: 0,
        usdAmount: 0,
        finalWalletObject: null,
        error: getErrorMessage(error, "Lightning balance debug failed")
      },
      { status: getRouteErrorStatus(error) }
    )
  }
}
