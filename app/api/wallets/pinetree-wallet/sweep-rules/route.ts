import { type NextRequest, NextResponse } from "next/server"
import { createMerchantSweepRule, listMerchantSweepRules } from "@/engine/withdrawals/walletSweepRules"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { makeRateLimiter, getRequestIp } from "@/lib/api/rateLimit"
import type { SweepMode, SweepRail, SweepAsset } from "@/database/walletSweepRules"

const createRateLimiter = makeRateLimiter({ windowMs: 60_000, maxRequests: 10 })

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const rules = await listMerchantSweepRules(merchantId)
    return NextResponse.json({ rules })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sweep rules"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    if (!createRateLimiter.check(`${merchantId}:${getRequestIp(req)}`).allowed) {
      return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
    }
    const body = (await req.json()) as Record<string, unknown>
    const rule = await createMerchantSweepRule(merchantId, {
      rail: String(body.rail || "") as SweepRail,
      asset: String(body.asset || "") as SweepAsset,
      destinationId: String(body.destination_id || body.destinationId || ""),
      mode: String(body.mode || "manual") as SweepMode,
      thresholdAmountDecimal: body.threshold_amount_decimal != null ? String(body.threshold_amount_decimal) : null,
      scheduledTimeUtc: body.scheduled_time_utc != null ? String(body.scheduled_time_utc) : null,
      minRemainingReserveDecimal: body.min_remaining_reserve_decimal != null ? String(body.min_remaining_reserve_decimal) : undefined,
      maxDailySweepUsd: body.max_daily_sweep_usd != null ? Number(body.max_daily_sweep_usd) : null,
      isEnabled: Boolean(body.is_enabled),
      acknowledgmentText: String(body.acknowledgment_text || body.acknowledgmentText || ""),
    })
    return NextResponse.json({ rule })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create sweep rule"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
