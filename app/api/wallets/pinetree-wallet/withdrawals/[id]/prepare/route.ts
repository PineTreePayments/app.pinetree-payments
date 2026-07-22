import { type NextRequest, NextResponse } from "next/server"
import { prepareDynamicWalletWithdrawal } from "@/engine/withdrawals/walletWithdrawals"
import { presentWithdrawalError } from "@/engine/withdrawals/withdrawalErrorPresentation"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { getDeploymentBuildId } from "@/lib/deploymentInfo"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = req.headers?.get("x-pinetree-withdrawal-correlation") || null
  const buildId = getDeploymentBuildId()
  const { id } = await params
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    console.info("[pinetree-withdrawals] PREPARE_RECEIVED", { correlationId, merchantId, requestId: id, buildId, routeStage: "prepare_received" })
    const result = await prepareDynamicWalletWithdrawal(merchantId, id)
    console.info("[pinetree-withdrawals] PREPARE_RETURNED", {
      correlationId, merchantId, requestId: id, buildId, routeStage: "prepare_returned", rail: result.rail, asset: result.asset,
    })
    return NextResponse.json(result)
  } catch (error) {
    const presented = presentWithdrawalError({
      rawMessage: error instanceof Error ? error.message : "Failed to prepare wallet approval",
    })
    console.warn("[pinetree-withdrawals] PREPARE_FAILED", { correlationId, requestId: id, buildId, routeStage: "prepare_failed", code: presented.code })
    return NextResponse.json(
      { error: presented.message, error_code: presented.code },
      { status: getRouteErrorStatus(error) }
    )
  }
}
