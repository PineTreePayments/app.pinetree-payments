import { after } from "next/server"
import { processQueuedLightningSweeps } from "@/engine/lightningSweep"

type MaintenanceLease = {
  lastStartedAt: number
  running: boolean
}

const globalWithLease = globalThis as typeof globalThis & {
  __pinetreeLightningSweepMaintenanceLease?: MaintenanceLease
}

function getLease(): MaintenanceLease {
  globalWithLease.__pinetreeLightningSweepMaintenanceLease ??= {
    lastStartedAt: 0,
    running: false,
  }
  return globalWithLease.__pinetreeLightningSweepMaintenanceLease
}

const DEFAULT_THROTTLE_MS = 15_000

/**
 * No-cron worker trigger, mirroring lib/api/paymentMaintenance.ts's
 * schedulePaymentMaintenance pattern. Safe to call unconditionally from a
 * webhook route or a merchant-facing GET route - the after() callback runs
 * post-response (never delays the caller), and the lease throttles overlapping
 * ticks on a warm serverless instance. A bounded batch (default 5 sweeps) is
 * processed per tick; never unbounded, never client-polled.
 */
export function scheduleLightningSweepProcessing(trigger: string, options?: { limit?: number }): void {
  after(async () => {
    const lease = getLease()
    const now = Date.now()
    if (lease.running || now - lease.lastStartedAt < DEFAULT_THROTTLE_MS) return

    lease.running = true
    lease.lastStartedAt = now
    try {
      await processQueuedLightningSweeps({ limit: options?.limit ?? 5 })
    } catch (error) {
      console.warn("[lightning-sweep-maintenance] tick failed", {
        trigger,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      lease.running = false
    }
  })
}

export function resetLightningSweepMaintenanceLeaseForTests(): void {
  globalWithLease.__pinetreeLightningSweepMaintenanceLease = {
    lastStartedAt: 0,
    running: false,
  }
}
