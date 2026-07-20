import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  processQueuedLightningSweeps: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void> | void>,
}))

vi.mock("next/server", () => ({
  after: (callback: () => Promise<void> | void) => {
    mocks.afterCallbacks.push(callback)
  },
}))

vi.mock("@/engine/lightningSweep", () => ({
  processQueuedLightningSweeps: mocks.processQueuedLightningSweeps,
}))

import {
  scheduleLightningSweepProcessing,
  resetLightningSweepMaintenanceLeaseForTests,
} from "@/lib/api/lightningSweepMaintenance"

async function flushScheduled() {
  const callbacks = mocks.afterCallbacks.splice(0)
  for (const callback of callbacks) {
    await callback()
  }
}

describe("scheduleLightningSweepProcessing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.afterCallbacks = []
    mocks.processQueuedLightningSweeps.mockResolvedValue({ scanned: 0, processed: 0, outcomes: {} })
    resetLightningSweepMaintenanceLeaseForTests()
  })

  it("does not schedule obsolete automatic sweep processing", () => {
    scheduleLightningSweepProcessing("webhook:speed")
    expect(mocks.processQueuedLightningSweeps).not.toHaveBeenCalled()
    expect(mocks.afterCallbacks.length).toBe(0)
  })

  it("ignores requested batch limits without processing funds", async () => {
    scheduleLightningSweepProcessing("webhook:speed", { limit: 3 })
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).not.toHaveBeenCalled()
  })

  it("remains inert for wallet page-load triggers", async () => {
    scheduleLightningSweepProcessing("wallet_page_load")
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).not.toHaveBeenCalled()
  })

  it("keeps reset compatibility without enabling processing", async () => {
    scheduleLightningSweepProcessing("webhook:speed")
    await flushScheduled()
    resetLightningSweepMaintenanceLeaseForTests()
    scheduleLightningSweepProcessing("webhook:speed")
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).not.toHaveBeenCalled()
  })
})
