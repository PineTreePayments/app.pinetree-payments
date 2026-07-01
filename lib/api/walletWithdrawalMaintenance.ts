import { after } from "next/server"
import { reconcileProcessingWithdrawals } from "@/engine/withdrawals/walletWithdrawalReconciliation"

export function scheduleWalletWithdrawalMaintenance(trigger: string): void {
  after(async () => {
    try {
      await reconcileProcessingWithdrawals({ limit: 10 })
    } catch (error) {
      console.warn("[wallet-withdrawal-maintenance] reconciliation failed", {
        trigger,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
