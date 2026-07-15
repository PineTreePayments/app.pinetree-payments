import { type NextRequest } from "next/server"
import { withWalletMerchant } from "@/lib/api/walletApiRoute"
import { getWalletPreferences, updateWalletPreferences } from "@/engine/wallet/walletPreferences"
import type { AutoPayoutSchedule } from "@/database/merchantWalletPreferences"

const VALID_SCHEDULES = new Set<AutoPayoutSchedule>(["disabled", "daily", "weekly", "threshold"])

export async function GET(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => getWalletPreferences(merchantId))
}

export async function PUT(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const schedule = typeof body.auto_payout_schedule === "string" ? body.auto_payout_schedule : undefined

    return updateWalletPreferences(merchantId, {
      autoPayoutEnabled: typeof body.auto_payout_enabled === "boolean" ? body.auto_payout_enabled : undefined,
      autoPayoutSchedule: schedule && VALID_SCHEDULES.has(schedule as AutoPayoutSchedule) ? (schedule as AutoPayoutSchedule) : undefined,
      autoPayoutDestination:
        body.auto_payout_destination === null || typeof body.auto_payout_destination === "string"
          ? (body.auto_payout_destination as string | null)
          : undefined,
      autoPayoutSourceAsset:
        body.auto_payout_source_asset === null || typeof body.auto_payout_source_asset === "string"
          ? (body.auto_payout_source_asset as string | null)
          : undefined,
      autoPayoutMinThresholdDecimal:
        body.auto_payout_min_threshold_decimal === null || typeof body.auto_payout_min_threshold_decimal === "string"
          ? (body.auto_payout_min_threshold_decimal as string | null)
          : undefined,
      autoPayoutRetainedBalanceDecimal:
        body.auto_payout_retained_balance_decimal === null || typeof body.auto_payout_retained_balance_decimal === "string"
          ? (body.auto_payout_retained_balance_decimal as string | null)
          : undefined,
      autoSwapEnabled: typeof body.auto_swap_enabled === "boolean" ? body.auto_swap_enabled : undefined,
      autoSwapSourceAsset:
        body.auto_swap_source_asset === null || typeof body.auto_swap_source_asset === "string"
          ? (body.auto_swap_source_asset as string | null)
          : undefined,
      autoSwapTargetAsset:
        body.auto_swap_target_asset === null || typeof body.auto_swap_target_asset === "string"
          ? (body.auto_swap_target_asset as string | null)
          : undefined,
      autoSwapMode:
        body.auto_swap_mode === null || typeof body.auto_swap_mode === "string"
          ? (body.auto_swap_mode as string | null)
          : undefined,
    })
  })
}
