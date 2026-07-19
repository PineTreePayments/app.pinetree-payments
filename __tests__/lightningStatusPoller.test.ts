import { afterEach, describe, expect, it, vi } from "vitest"
import {
  LightningStatusPoller,
  acquireLightningStatusPoller,
  getActiveLightningPollerCountForTests,
} from "@/lib/lightning/lightningStatusPoller"

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync().catch(() => undefined)
  vi.useRealTimers()
})

describe("LightningStatusPoller", () => {
  it("checks immediately, maintains one registry poller per payment, and survives a Strict Mode remount", async () => {
    vi.useFakeTimers()
    const check = vi.fn().mockResolvedValue({ status: "PENDING" })
    const first = acquireLightningStatusPoller("payment-1", { check })
    const second = acquireLightningStatusPoller("payment-1", { check })
    await vi.advanceTimersByTimeAsync(0)

    expect(getActiveLightningPollerCountForTests()).toBe(1)
    expect(check).toHaveBeenCalledTimes(1)
    first.release()
    second.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(getActiveLightningPollerCountForTests()).toBe(0)
  })

  it("never overlaps requests even when more than one interval window elapses", async () => {
    vi.useFakeTimers()
    let resolve!: (value: { status: string }) => void
    const check = vi.fn(() => new Promise<{ status: string }>((done) => { resolve = done }))
    const poller = new LightningStatusPoller({ check })
    poller.start()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(check).toHaveBeenCalledTimes(1)

    resolve({ status: "PENDING" })
    await vi.advanceTimersByTimeAsync(2_500)
    expect(check).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it("clears timers on stop and stops permanently on every terminal response", async () => {
    vi.useFakeTimers()
    for (const status of ["CONFIRMED", "FAILED", "EXPIRED", "INCOMPLETE", "cancelled"]) {
      const check = vi.fn().mockResolvedValue({ status })
      const poller = new LightningStatusPoller({ check })
      poller.start()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(check, status).toHaveBeenCalledTimes(1)
      poller.stop()
    }
  })

  it("pauses while hidden/offline and resumes with one immediate non-overlapping check", async () => {
    vi.useFakeTimers()
    const check = vi.fn().mockResolvedValue({ status: "PENDING" })
    const poller = new LightningStatusPoller({ check })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.pause()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(check).toHaveBeenCalledTimes(1)

    poller.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(2)
    poller.setOffline(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(check).toHaveBeenCalledTimes(2)
    poller.setOffline(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(3)
    poller.stop()
  })

  it("uses bounded 2.5s-to-9s backoff and a finite attempt ceiling", async () => {
    vi.useFakeTimers()
    const check = vi.fn().mockResolvedValue({ status: "PENDING" })
    const poller = new LightningStatusPoller({ check, maxAttempts: 5 })
    poller.start()
    await vi.advanceTimersByTimeAsync(2_499)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(check).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(check).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(check).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(check).toHaveBeenCalledTimes(5)
  })

  it("swallows an offline transport error and continues reconciliation without exposing it", async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const check = vi.fn()
      .mockRejectedValueOnce(new Error("raw provider network failure"))
      .mockResolvedValue({ status: "PENDING" })
    const poller = new LightningStatusPoller({ check, onError })
    poller.start()
    await vi.advanceTimersByTimeAsync(2_500)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledTimes(2)
    poller.stop()
  })
})
