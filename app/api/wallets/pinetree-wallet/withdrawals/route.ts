import { type NextRequest, NextResponse } from "next/server"
import {
  createWalletWithdrawalReview,
  submitWalletWithdrawalRequest,
} from "@/engine/withdrawals/walletWithdrawals"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { updateWalletWithdrawalRequestCanonicalFields } from "@/database/walletWithdrawalRequests"
import { submitCanonicalWithdrawal } from "@/engine/withdrawals/canonicalWithdrawal"
import { normalizeWithdrawalRail, normalizeWithdrawalAsset } from "@/engine/withdrawals/walletWithdrawals"
import { presentWithdrawalError } from "@/engine/withdrawals/withdrawalErrorPresentation"

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

    const rail = String(body.rail || "")
    const asset = String(body.asset || "")
    const amountDecimal = String(body.amount_decimal || body.amountDecimal || "")
    const destinationId = body.destination_id !== undefined ? String(body.destination_id) : undefined

    // A saved destination was picked - route through the canonical dispatcher
    // (same entrypoint automatic sweeps use) so this review is correctly
    // stamped source="saved_address" with a point-in-time destination
    // snapshot. Bitcoin never reaches this route in the live UI (it POSTs
    // directly to /api/wallets/withdrawals) - reject it explicitly here
    // rather than silently diverging from that path's behavior.
    if (destinationId) {
      const normalizedRail = normalizeWithdrawalRail(rail)
      const normalizedAsset = normalizeWithdrawalAsset(asset)
      if (normalizedRail === "bitcoin") {
        return NextResponse.json(
          { error: "Bitcoin saved-address withdrawals must use /api/wallets/withdrawals." },
          { status: 400 }
        )
      }
      if (!normalizedRail || !normalizedAsset) {
        return NextResponse.json({ error: "Unsupported rail or asset." }, { status: 400 })
      }
      const idempotencyKey = `saved-review:${merchantId}:${normalizedRail}:${normalizedAsset}:${destinationId}:${amountDecimal}`
      const canonical = await submitCanonicalWithdrawal({
        merchantId,
        rail: normalizedRail,
        asset: normalizedAsset,
        amountDecimal,
        source: "saved_address",
        idempotencyKey,
        destinationId,
      })
      if (canonical.kind === "review_required") {
        return NextResponse.json({
          request: canonical.request,
          review: canonical.review,
          canSubmit: canonical.canSubmit,
        })
      }
    }

    const result = await createWalletWithdrawalReview(merchantId, {
      rail,
      asset,
      destinationAddress: String(body.destination_address || body.destinationAddress || ""),
      amountDecimal,
    })

    // Stamps this row as a plain manual (freely-typed address) withdrawal for
    // Activity/reporting parity with saved-address and automatic-sweep
    // withdrawals, which both go through engine/withdrawals/canonicalWithdrawal.ts.
    // Best-effort - never fails the review itself if this write has an issue.
    const request = await updateWalletWithdrawalRequestCanonicalFields(merchantId, result.request.id, {
      source: "manual",
    }).catch(() => result.request)

    return NextResponse.json({ ...result, request })
  } catch (error) {
    const presented = presentWithdrawalError({
      rawMessage: error instanceof Error ? error.message : "Failed to prepare withdrawal review",
    })
    return NextResponse.json(
      { error: presented.message, error_code: presented.code },
      { status: getRouteErrorStatus(error) }
    )
  }
}
