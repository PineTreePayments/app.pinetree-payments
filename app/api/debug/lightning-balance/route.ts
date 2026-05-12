import { NextRequest, NextResponse } from "next/server"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"
import { supabase, supabaseAdmin } from "@/database"
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
      .select("credentials")
      .eq("merchant_id", merchantId)
      .eq("provider", "lightning")
      .in("status", ["connected", "active"])
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to load Lightning provider: ${error.message}`)
    }

    const credentials = (data?.credentials || {}) as Record<string, unknown>
    const speedAccountId = String(credentials.speed_account_id || "").trim()
    const diagnostics = await getSpeedAccountBalanceDiagnostics(speedAccountId)

    console.info("[lightning/debug-balance] result", {
      merchantId,
      speedAccountIdMasked: maskSpeedAccountId(speedAccountId),
      hasApiKey: diagnostics.hasApiKey,
      baseUrl: diagnostics.baseUrl,
      httpStatus: diagnostics.httpStatus,
      responseKeys: diagnostics.responseKeys,
      balancesFound: diagnostics.balancesFound,
      rawNumericAmount: diagnostics.rawNumericAmount,
      satsAmount: diagnostics.satsAmount,
      btcAmount: diagnostics.btcAmount,
      error: diagnostics.error
    })

    return NextResponse.json({
      merchantId,
      hasApiKey: diagnostics.hasApiKey,
      baseUrl: diagnostics.baseUrl,
      speedAccountIdMasked: diagnostics.speedAccountIdMasked,
      httpStatus: diagnostics.httpStatus,
      responseKeys: diagnostics.responseKeys,
      balancesFound: diagnostics.balancesFound,
      rawNumericAmount: diagnostics.rawNumericAmount,
      satsAmount: diagnostics.satsAmount,
      btcAmount: diagnostics.btcAmount,
      error: diagnostics.error
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Lightning balance debug failed") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
