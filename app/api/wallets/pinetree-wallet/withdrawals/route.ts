import { type NextRequest, NextResponse } from "next/server"
import { createWalletWithdrawalReview } from "@/engine/withdrawals/walletWithdrawals"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>
    const result = await createWalletWithdrawalReview(merchantId, {
      rail: String(body.rail || ""),
      asset: String(body.asset || ""),
      destinationAddress: String(body.destination_address || body.destinationAddress || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare withdrawal review"
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(error) }
    )
  }
}
