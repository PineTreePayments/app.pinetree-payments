import { afterEach, describe, expect, it, vi } from "vitest"
import {
  POS_RESULT_RESET_DELAY_MS,
  cancelPosResultReset,
  isPosTerminalUiStatus,
  schedulePosResultReset,
  type PosResultResetTimerHandle,
} from "@/lib/pos/posResultResetTimer"

afterEach(() => {
  vi.useRealTimers()
})

describe("isPosTerminalUiStatus", () => {
  it("recognizes every canonical terminal UI status", () => {
    for (const status of ["confirmed", "incomplete", "failed", "expired", "cancelled"]) {
      expect(isPosTerminalUiStatus(status)).toBe(true)
    }
  })

  it("rejects active/non-terminal statuses", () => {
    for (const status of ["ready", "confirm", "cash-tender", "cash-change", "waiting", "processing", ""]) {
      expect(isPosTerminalUiStatus(status)).toBe(false)
    }
  })
})

describe("schedulePosResultReset", () => {
  it("fires onReset after exactly POS_RESULT_RESET_DELAY_MS (3s) when the generation is unchanged", () => {
    vi.useFakeTimers()
    const handle: PosResultResetTimerHandle = { current: null }
    const onReset = vi.fn()
    schedulePosResultReset(handle, 1, () => 1, onReset)

    vi.advanceTimersByTime(POS_RESULT_RESET_DELAY_MS - 1)
    expect(onReset).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(handle.current).toBeNull()
  })

  it("does not reset when the generation has moved on by the time the timer fires (manual dismiss, cancel, or a new sale)", () => {
    vi.useFakeTimers()
    const handle: PosResultResetTimerHandle = { current: null }
    const onReset = vi.fn()
    let currentGeneration = 1
    schedulePosResultReset(handle, 1, () => currentGeneration, onReset)

    // Simulate resetSale() bumping the generation before the timer fires —
    // e.g. the merchant manually dismissed the result screen.
    currentGeneration = 2
    vi.advanceTimersByTime(POS_RESULT_RESET_DELAY_MS)
    expect(onReset).not.toHaveBeenCalled()
  })

  it("cancelPosResultReset prevents a pending timer from ever firing", () => {
    vi.useFakeTimers()
    const handle: PosResultResetTimerHandle = { current: null }
    const onReset = vi.fn()
    schedulePosResultReset(handle, 1, () => 1, onReset)
    expect(handle.current).not.toBeNull()

    cancelPosResultReset(handle)
    expect(handle.current).toBeNull()

    vi.advanceTimersByTime(POS_RESULT_RESET_DELAY_MS)
    expect(onReset).not.toHaveBeenCalled()
  })

  it("cancelPosResultReset on an already-empty handle is a no-op", () => {
    const handle: PosResultResetTimerHandle = { current: null }
    expect(() => cancelPosResultReset(handle)).not.toThrow()
    expect(handle.current).toBeNull()
  })

  it("scheduling again cancels any previously pending timer — only one reset timer is ever live at a time", () => {
    vi.useFakeTimers()
    const handle: PosResultResetTimerHandle = { current: null }
    const firstOnReset = vi.fn()
    const secondOnReset = vi.fn()

    schedulePosResultReset(handle, 1, () => 1, firstOnReset)
    // A second terminal result (e.g. a late realtime event re-firing the
    // effect) must not leave the first timer also armed.
    vi.advanceTimersByTime(1000)
    schedulePosResultReset(handle, 2, () => 2, secondOnReset)

    vi.advanceTimersByTime(POS_RESULT_RESET_DELAY_MS)
    expect(firstOnReset).not.toHaveBeenCalled()
    expect(secondOnReset).toHaveBeenCalledTimes(1)
  })

  it("a late timer for a superseded (previous) payment cannot reset a newer sale that has already started", () => {
    vi.useFakeTimers()
    const handle: PosResultResetTimerHandle = { current: null }
    const onReset = vi.fn()
    let currentGeneration = 5

    // Old sale reaches a terminal result and schedules its reset...
    schedulePosResultReset(handle, currentGeneration, () => currentGeneration, onReset)

    // ...but a brand new sale starts (and itself calls resetSale-equivalent
    // logic that bumps the generation) before the 3s elapses.
    currentGeneration += 1

    vi.advanceTimersByTime(POS_RESULT_RESET_DELAY_MS)
    // The stale timer must not fire resetSale on top of the new sale.
    expect(onReset).not.toHaveBeenCalled()
  })

  it("respects a custom delay override", () => {
    vi.useFakeTimers()
    const handle: PosResultResetTimerHandle = { current: null }
    const onReset = vi.fn()
    schedulePosResultReset(handle, 1, () => 1, onReset, 500)

    vi.advanceTimersByTime(499)
    expect(onReset).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
