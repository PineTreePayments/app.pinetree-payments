import { type NextRequest, NextResponse } from "next/server"
import {
  createWalletWithdrawalReview,
  submitWalletWithdrawalRequest,
} from "@/engine/withdrawals/walletWithdrawals"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { updateWalletWithdrawalRequestCanonicalFields } from "@/database/walletWithdrawalRequests"
import { submitCanonicalWithdrawal } from "@/engine/withdrawals/canonicalWithdrawal"
import { normalizeWithdrawalRail, normalizeWithdrawalAsset } from "@/engine/withdrawals/walletWithdrawals"
import { getSweepJobForMerchant, updateSweepJob } from "@/database/walletSweepJobs"
import { getSweepRule } from "@/database/walletSweepRules"

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

    const sweepJobId = body.sweep_job_id !== undefined ? String(body.sweep_job_id) : undefined

    // A queued Base/Solana automatic-sweep job is being continued client-
    // side (the merchant's device is the only thing that can sign for these
    // self-custodial rails - see engine/withdrawals/walletSweepExecution.ts's
    // header comment). Reuses the exact same review-creation path as every
    // other withdrawal, just stamped source="automatic_sweep" with a
    // deterministic idempotency key so re-driving this after a page refresh
    // never creates a second review for the same job.
    if (sweepJobId) {
      const job = await getSweepJobForMerchant(merchantId, sweepJobId)
      if (!job || (job.status !== "QUEUED" && job.status !== "AWAITING_GAS")) {
        return NextResponse.json({ error: "This automatic sweep job is not ready to continue." }, { status: 409 })
      }
      const rule = await getSweepRule(merchantId, job.rule_id)
      if (!rule) {
        return NextResponse.json({ error: "Sweep rule not found." }, { status: 404 })
      }
      const canonical = await submitCanonicalWithdrawal({
        merchantId,
        rail: job.rail,
        asset: job.asset,
        amountDecimal: job.amount_decimal,
        source: "automatic_sweep",
        idempotencyKey: `sweep-review:${job.id}`,
        destinationId: rule.destination_id,
      })
      if (canonical.kind === "review_required") {
        await updateSweepJob(job.id, {
          withdrawalSourceTable: "wallet_withdrawal_requests",
          withdrawalId: canonical.request.id,
        }).catch(() => undefined)
        return NextResponse.json({
          request: canonical.request,
          review: canonical.review,
          canSubmit: canonical.canSubmit,
        })
      }
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
    const message = getMerchantSafeWithdrawalRouteError(error)
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(error) }
    )
  }
}
