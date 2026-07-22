import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { syncPineTreeWalletBalances } from "@/engine/pineTreeWalletSync"
import { scheduleWalletWithdrawalMaintenance } from "@/lib/api/walletWithdrawalMaintenance"
import { reconcileProcessingWithdrawals } from "@/engine/withdrawals/walletWithdrawalReconciliation"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    // Reconcile THIS merchant's own processing withdrawals synchronously,
    // before computing the snapshot below - the global sweep
    // (scheduleWalletWithdrawalMaintenance) runs via Next's after() hook,
    // which fires only once this response has already been sent, so it can
    // never affect what this same request returns. Without this, a merchant
    // who reopens their wallet right after a withdrawal actually confirms
    // provider-side would still see the pre-reconciliation "Processing"
    // snapshot - the very case this repair targets. Scoped to one merchant
    // and a small limit so it stays fast; failures never block the sync.
    await reconcileProcessingWithdrawals({ limit: 10, merchantId }).catch((error) => {
      console.warn("[pinetree-wallet-sync] inline_reconcile_failed", {
        merchantId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    const result = await syncPineTreeWalletBalances(merchantId)
    scheduleWalletWithdrawalMaintenance("pinetree-wallet.sync")
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync PineTree Wallet"
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(error) }
    )
  }
}
