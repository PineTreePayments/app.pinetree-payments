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

  it("defers the actual processing via after() - never runs synchronously inline", () => {
    scheduleLightningSweepProcessing("webhook:speed")
    expect(mocks.processQueuedLightningSweeps).not.toHaveBeenCalled()
    expect(mocks.afterCallbacks.length).toBe(1)
  })

  it("processes a bounded batch once the deferred callback runs", async () => {
    scheduleLightningSweepProcessing("webhook:speed", { limit: 3 })
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).toHaveBeenCalledWith({ limit: 3 })
  })

  it("defaults to a limit of 5 when none is given", async () => {
    scheduleLightningSweepProcessing("wallet_page_load")
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).toHaveBeenCalledWith({ limit: 5 })
  })

  it("throttles overlapping ticks on a warm instance instead of running every call", async () => {
    scheduleLightningSweepProcessing("webhook:speed")
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).toHaveBeenCalledTimes(1)

    // Immediately schedule again - within the throttle window.
    scheduleLightningSweepProcessing("webhook:speed")
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).toHaveBeenCalledTimes(1)
  })

  it("never throws or crashes the caller when processing fails", async () => {
    mocks.processQueuedLightningSweeps.mockRejectedValue(new Error("db unavailable"))
    scheduleLightningSweepProcessing("webhook:speed")
    await expect(flushScheduled()).resolves.toBeUndefined()
  })

  it("releases the lease after success so a later (non-throttled) call can run again", async () => {
    scheduleLightningSweepProcessing("webhook:speed")
    await flushScheduled()
    resetLightningSweepMaintenanceLeaseForTests()
    scheduleLightningSweepProcessing("webhook:speed")
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).toHaveBeenCalledTimes(2)
  })

  it("releases the lease after a failure too, not just after success", async () => {
    mocks.processQueuedLightningSweeps.mockRejectedValueOnce(new Error("transient"))
    scheduleLightningSweepProcessing("webhook:speed")
    await flushScheduled()

    resetLightningSweepMaintenanceLeaseForTests()
    mocks.processQueuedLightningSweeps.mockResolvedValueOnce({ scanned: 0, processed: 0, outcomes: {} })
    scheduleLightningSweepProcessing("webhook:speed")
    await flushScheduled()
    expect(mocks.processQueuedLightningSweeps).toHaveBeenCalledTimes(2)
  })
})
