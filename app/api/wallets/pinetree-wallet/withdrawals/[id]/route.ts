import { type NextRequest, NextResponse } from "next/server"
import { getWalletWithdrawalRequest } from "@/database/walletWithdrawalRequests"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { reconcileProcessingWithdrawals } from "@/engine/withdrawals/walletWithdrawalReconciliation"

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
    const hasProviderEvidence = Boolean(String(request.tx_hash || request.provider_reference || "").trim())
    if (request.status === "processing" && hasProviderEvidence) {
      await reconcileProcessingWithdrawals({ limit: 10, merchantId }).catch((error) => {
        console.warn("[pinetree-withdrawals] status_endpoint_reconciliation_failed", {
          merchantId,
          requestId: id,
          error: error instanceof Error ? error.message : "unknown_error",
        })
      })
      const reconciled = await getWalletWithdrawalRequest(merchantId, id)
      return NextResponse.json({ request: reconciled ?? request }, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      })
    }
    return NextResponse.json({ request }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load withdrawal request"
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(error) }
    )
  }
}
