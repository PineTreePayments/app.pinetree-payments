import { type NextRequest, NextResponse } from "next/server"
import { updateMerchantSweepRule } from "@/engine/withdrawals/walletSweepRules"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { makeRateLimiter, getRequestIp } from "@/lib/api/rateLimit"
import type { SweepMode } from "@/database/walletSweepRules"

const updateRateLimiter = makeRateLimiter({ windowMs: 60_000, maxRequests: 20 })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    if (!updateRateLimiter.check(`${merchantId}:${getRequestIp(req)}`).allowed) {
      return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
    }
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
    const rule = await updateMerchantSweepRule(merchantId, id, {
      isEnabled: body.is_enabled !== undefined ? Boolean(body.is_enabled) : undefined,
      mode: body.mode !== undefined ? (String(body.mode) as SweepMode) : undefined,
      thresholdAmountDecimal: body.threshold_amount_decimal !== undefined ? (body.threshold_amount_decimal === null ? null : String(body.threshold_amount_decimal)) : undefined,
      scheduledTimeUtc: body.scheduled_time_utc !== undefined ? (body.scheduled_time_utc === null ? null : String(body.scheduled_time_utc)) : undefined,
      minRemainingReserveDecimal: body.min_remaining_reserve_decimal !== undefined ? String(body.min_remaining_reserve_decimal) : undefined,
      maxDailySweepUsd: body.max_daily_sweep_usd !== undefined ? (body.max_daily_sweep_usd === null ? null : Number(body.max_daily_sweep_usd)) : undefined,
      acknowledgmentText: body.acknowledgment_text !== undefined ? String(body.acknowledgment_text) : undefined,
    })
    return NextResponse.json({ rule })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update sweep rule"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
