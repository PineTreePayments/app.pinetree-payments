import { type NextRequest, NextResponse } from "next/server"
import {
  createWalletWithdrawalReview,
  submitWalletWithdrawalRequest,
} from "@/engine/withdrawals/walletWithdrawals"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

function getMerchantSafeWithdrawalRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to prepare withdrawal review"
  if (/schema cache|column|wallet_withdrawal_requests|amount_decimal|failed to create wallet withdrawal request/i.test(message)) {
    console.error("[pinetree-wallet-withdrawals] internal withdrawal request error", error)
    return "We couldn't create this withdrawal request. Please try again."
  }
  return message
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action || "review").trim().toLowerCase()

    if (action === "submit") {
      const withdrawalId = String(body.withdrawal_id || body.withdrawalId || "").trim()
      if (!withdrawalId) {
        return NextResponse.json({ error: "withdrawal_id is required" }, { status: 400 })
      }
      const result = await submitWalletWithdrawalRequest(merchantId, withdrawalId)
      return NextResponse.json(result)
    }

    const result = await createWalletWithdrawalReview(merchantId, {
      rail: String(body.rail || ""),
      asset: String(body.asset || ""),
      destinationAddress: String(body.destination_address || body.destinationAddress || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = getMerchantSafeWithdrawalRouteError(error)
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(error) }
    )
  }
}
