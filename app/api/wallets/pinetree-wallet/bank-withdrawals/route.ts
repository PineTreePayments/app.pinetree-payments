import { type NextRequest, NextResponse } from "next/server"

import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { createBankWithdrawalReviewEngine } from "@/engine/withdrawals/bankWithdrawals"
import { presentWithdrawalError } from "@/engine/withdrawals/withdrawalErrorPresentation"
import { WithdrawalPreflightError } from "@/engine/withdrawals/withdrawalPreflightResult"

/**
 * Create a withdrawal review that settles to the merchant's bank account.
 *
 * A thin wrapper. The Engine ensures the settlement route, then runs the SAME
 * review path every Base/Solana withdrawal uses, so the response shape matches
 * `/api/wallets/pinetree-wallet/withdrawals` and the existing browser
 * prepare -> authorize -> submit flow drives it unchanged.
 */
export async function POST(req: NextRequest) {
  const correlationId = req.headers?.get("x-pinetree-withdrawal-correlation") || null

  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const bankDestinationId = String(
      body.bank_destination_id || body.bankDestinationId || ""
    ).trim()
    if (!bankDestinationId) {
      return NextResponse.json({ error: "Choose a bank account." }, { status: 400 })
    }

    const result = await createBankWithdrawalReviewEngine({
      merchantId,
      rail: String(body.rail || ""),
      asset: String(body.asset || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
      bankDestinationId,
      correlationId,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.retryable ? 503 : 400 })
    }

    return NextResponse.json({
      request: result.request,
      review: result.review,
      canSubmit: result.canSubmit,
      preflight: result.preflight,
    })
  } catch (error) {
    const preflight = error instanceof WithdrawalPreflightError ? error.preflight : undefined
    const presented = presentWithdrawalError({
      code: error instanceof WithdrawalPreflightError ? error.code : undefined,
      rawMessage: error instanceof Error ? error.message : "Failed to prepare withdrawal review",
    })
    return NextResponse.json(
      { error: presented.message, error_code: presented.code, ...(preflight ? { preflight } : {}) },
      { status: getRouteErrorStatus(error) }
    )
  }
}
