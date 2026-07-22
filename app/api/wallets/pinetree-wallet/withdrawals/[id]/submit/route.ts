import { type NextRequest, NextResponse } from "next/server"
import { completeDynamicWalletWithdrawal } from "@/engine/withdrawals/walletWithdrawals"
import { presentWithdrawalError } from "@/engine/withdrawals/withdrawalErrorPresentation"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { scheduleWalletWithdrawalMaintenance } from "@/lib/api/walletWithdrawalMaintenance"
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
    const body = (await req.json()) as Record<string, unknown>
    console.info("[pinetree-withdrawals] SUBMIT_RECEIVED", {
      correlationId, merchantId, requestId: id, buildId, routeStage: "submit_received",
      hasTxHash: Boolean(body.tx_hash || body.txHash),
      hasSignedPsbt: Boolean(body.signed_psbt || body.signedPsbt),
    })
    const result = await completeDynamicWalletWithdrawal(merchantId, id, {
      txHash: String(body.tx_hash || body.txHash || "").trim(),
      providerReference: body.provider_reference != null || body.providerReference != null
        ? String(body.provider_reference || body.providerReference)
        : null,
      signedPsbtBase64: body.signed_psbt != null || body.signedPsbt != null
        ? String(body.signed_psbt || body.signedPsbt)
        : null,
      signedPayload:
        typeof body.signed_payload === "object" && body.signed_payload !== null && !Array.isArray(body.signed_payload)
          ? body.signed_payload as Record<string, unknown>
          : null,
    })
    console.info("[pinetree-withdrawals] DYNAMIC_SUBMIT_ACCEPTED", {
      correlationId,
      merchantId,
      requestId: id,
      buildId,
      routeStage: "dynamic_submit_accepted",
      status: result.request.status,
      txHashPresent: Boolean(result.request.tx_hash),
      providerReferencePresent: Boolean(result.request.provider_reference),
    })
    console.info("[pinetree-withdrawals] SUBMIT_RETURNED", {
      correlationId, merchantId, requestId: id, buildId, routeStage: "submit_returned", merchantStatus: result.merchantStatus,
    })
    scheduleWalletWithdrawalMaintenance("wallet-withdrawal.submit")
    return NextResponse.json(result)
  } catch (error) {
    const presented = presentWithdrawalError({
      rawMessage: error instanceof Error ? error.message : "Failed to submit wallet approval",
    })
    console.warn("[pinetree-withdrawals] SUBMIT_FAILED", { correlationId, requestId: id, buildId, routeStage: "submit_failed", code: presented.code })
    return NextResponse.json(
      { error: presented.message, error_code: presented.code },
      { status: getRouteErrorStatus(error) }
    )
  }
}
