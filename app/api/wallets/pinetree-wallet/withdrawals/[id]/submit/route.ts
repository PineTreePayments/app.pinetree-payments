import { type NextRequest, NextResponse } from "next/server"
import { completeDynamicWalletWithdrawal } from "@/engine/withdrawals/walletWithdrawals"
import { presentWithdrawalError } from "@/engine/withdrawals/withdrawalErrorPresentation"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { scheduleWalletWithdrawalMaintenance } from "@/lib/api/walletWithdrawalMaintenance"
import { getDeploymentBuildId } from "@/lib/deploymentInfo"
import { syncPineTreeWalletBalances } from "@/engine/pineTreeWalletSync"

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
    if (result.request.tx_hash) {
      console.info("[pinetree-withdrawals] transaction_hash_persisted", {
        correlationId,
        merchantId,
        requestId: id,
        rail: result.request.rail,
        asset: result.request.asset,
        provider: "dynamic",
        txHashSuffix: result.request.tx_hash.slice(-8),
      })
    }
    console.info("[pinetree-withdrawals] SUBMIT_RETURNED", {
      correlationId, merchantId, requestId: id, buildId, routeStage: "submit_returned", merchantStatus: result.merchantStatus,
    })
    // Fire-and-forget: the transaction is already broadcast/persisted at this point
    // (completeDynamicWalletWithdrawal above already succeeded), so the client must
    // leave the "approving" screen now. A slow or hung Base/Solana RPC call inside
    // this multi-rail balance resync must never block the submit response - it used
    // to, which left the UI stuck on "Approving withdrawal" indefinitely even after
    // Dynamic had already accepted the transaction.
    void syncPineTreeWalletBalances(merchantId).catch((syncError) => {
      console.warn("[pinetree-balances] withdrawal_submit_balance_sync_failed", {
        merchantId,
        requestId: id,
        rail: result.request.rail,
        asset: result.request.asset,
        error: syncError instanceof Error ? syncError.message : "unknown_error",
      })
    })
    scheduleWalletWithdrawalMaintenance("wallet-withdrawal.submit")
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
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
