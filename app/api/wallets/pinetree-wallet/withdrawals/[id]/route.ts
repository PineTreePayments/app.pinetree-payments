import { type NextRequest, NextResponse } from "next/server"
import { getWalletWithdrawalRequest } from "@/database/walletWithdrawalRequests"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await params
    const request = await getWalletWithdrawalRequest(merchantId, id)
    if (!request) {
      return NextResponse.json({ error: "Withdrawal request not found." }, { status: 404 })
    }
    return NextResponse.json({ request })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load withdrawal request"
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(error) }
    )
  }
}
