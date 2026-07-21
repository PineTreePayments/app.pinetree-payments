import { type NextRequest, NextResponse } from "next/server"
import { estimateMaxWithdrawalAmount } from "@/engine/withdrawals/withdrawalFeeEstimate"
import { normalizeWithdrawalRail, normalizeWithdrawalAsset } from "@/engine/withdrawals/walletWithdrawals"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>
    const rail = normalizeWithdrawalRail(String(body.rail || ""))
    const asset = normalizeWithdrawalAsset(String(body.asset || ""))

    if (!rail || !asset) {
      return NextResponse.json({ error: "Unsupported rail or asset." }, { status: 400 })
    }

    const estimate = await estimateMaxWithdrawalAmount(merchantId, rail, asset)
    return NextResponse.json({ estimate })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to estimate maximum withdrawal amount"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
