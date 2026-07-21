import { type NextRequest, NextResponse } from "next/server"
import { completeDynamicWalletWithdrawal } from "@/engine/withdrawals/walletWithdrawals"
import { presentWithdrawalError } from "@/engine/withdrawals/withdrawalErrorPresentation"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { scheduleWalletWithdrawalMaintenance } from "@/lib/api/walletWithdrawalMaintenance"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
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
    scheduleWalletWithdrawalMaintenance("wallet-withdrawal.submit")
    return NextResponse.json(result)
  } catch (error) {
    const presented = presentWithdrawalError({
      rawMessage: error instanceof Error ? error.message : "Failed to submit wallet approval",
    })
    return NextResponse.json(
      { error: presented.message, error_code: presented.code },
      { status: getRouteErrorStatus(error) }
    )
  }
}
