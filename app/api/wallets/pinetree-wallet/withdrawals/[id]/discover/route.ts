import { type NextRequest, NextResponse } from "next/server"
import { getWalletWithdrawalRequest } from "@/database/walletWithdrawalRequests"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { recoverPendingDynamicWithdrawals } from "@/engine/withdrawals/pendingDynamicWithdrawalRecovery"

/**
 * Targeted chain discovery for a withdrawal the browser is signing RIGHT NOW.
 *
 * Root cause this serves (production incident, 0.38 Solana USDC): Dynamic's
 * SDK delivers the broadcast signature to the awaiting caller only when its
 * TransactionConfirmationModal *unmounts*
 * (TransactionConfirmationModal.handleOnModalUnmount -> onTransactionResponseSuccess).
 * When that modal keeps spinning, the transaction is already broadcast and
 * confirmed on-chain while the signature sits unreachable inside Dynamic's
 * ref - so PineTree cannot persist it, and the withdrawal stays "Waiting".
 *
 * This lets the client ask the Engine to look for the transaction on-chain
 * immediately, in parallel with awaiting the SDK, instead of waiting for the
 * background sweep's grace window. Discovery uses the same conservative
 * exact-match adoption as the sweep (source, destination, asset/mint, amount,
 * success, block time) - it can only ever adopt a real, successful,
 * matching transaction.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = req.headers?.get("x-pinetree-withdrawal-correlation") || null
  const { id } = await params
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    // Tenant scoping: the row must belong to this merchant. getWalletWithdrawalRequest
    // is merchant-scoped, and the recovery call below is scoped again by both
    // merchantId and withdrawalId.
    const existing = await getWalletWithdrawalRequest(merchantId, id)
    if (!existing) {
      return NextResponse.json({ error: "Withdrawal request not found." }, { status: 404 })
    }

    // Already has authoritative evidence - nothing to discover, just report it.
    if (String(existing.tx_hash || existing.provider_reference || "").trim()) {
      return NextResponse.json(
        { request: existing, discovered: false, reason: "evidence_already_present" },
        { headers: { "Cache-Control": "private, no-store, max-age=0" } }
      )
    }

    console.info("[pinetree-withdrawals] DISCOVERY_REQUESTED", {
      correlationId,
      merchantId,
      withdrawalId: id,
      rail: existing.rail,
      asset: existing.asset,
    })

    const result = await recoverPendingDynamicWithdrawals({
      limit: 1,
      merchantId,
      withdrawalId: id,
      minAgeMs: 0,
    })

    const refreshed = await getWalletWithdrawalRequest(merchantId, id)
    console.info("[pinetree-withdrawals] DISCOVERY_RETURNED", {
      correlationId,
      merchantId,
      withdrawalId: id,
      recovered: result.recovered,
      unmatched: result.unmatched,
      status: refreshed?.status ?? null,
      evidencePresent: Boolean(String(refreshed?.tx_hash || refreshed?.provider_reference || "").trim()),
    })

    return NextResponse.json(
      { request: refreshed ?? existing, discovered: result.recovered > 0 },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Withdrawal discovery failed"
    console.warn("[pinetree-withdrawals] DISCOVERY_FAILED", {
      correlationId,
      withdrawalId: id,
      error: message,
    })
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
