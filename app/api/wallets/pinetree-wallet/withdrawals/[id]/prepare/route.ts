import { type NextRequest, NextResponse } from "next/server"
import { prepareDynamicWalletWithdrawal } from "@/engine/withdrawals/walletWithdrawals"
import { presentWithdrawalError } from "@/engine/withdrawals/withdrawalErrorPresentation"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await params
    const result = await prepareDynamicWalletWithdrawal(merchantId, id)
    return NextResponse.json(result)
  } catch (error) {
    const presented = presentWithdrawalError({
      rawMessage: error instanceof Error ? error.message : "Failed to prepare wallet approval",
    })
    return NextResponse.json(
      { error: presented.message, error_code: presented.code },
      { status: getRouteErrorStatus(error) }
    )
  }
}
