import { type NextRequest, NextResponse } from "next/server"
import { removeWithdrawalDestination } from "@/engine/withdrawals/withdrawalDestinations"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await params
    await removeWithdrawalDestination(merchantId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete destination"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
