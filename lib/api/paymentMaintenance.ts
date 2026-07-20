import { after } from "next/server"
import { runPaymentMaintenanceTick } from "@/engine/paymentMaintenance"

export function schedulePaymentMaintenance(trigger: string): void {
  after(async () => {
    try {
      await runPaymentMaintenanceTick({
        sweepLimit: 10,
        watcherLimit: 2,
        reconcileLimit: 10,
        lightningReconcileLimit: 5
      })
    } catch (error) {
      console.warn("[payment-maintenance] tick failed", {
        trigger,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
}
