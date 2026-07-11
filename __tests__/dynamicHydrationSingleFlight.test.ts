import { describe, expect, it } from "vitest"
import { createBoundedSingleFlight } from "@/lib/wallets/boundedSingleFlight"

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Simulates elapsed wall-clock time without depending on vi.useFakeTimers()' interaction
// with real pending microtask chains (deferred promises resolve on the real microtask
// queue regardless of the fake clock), while still exercising the exact age/timeout
// arithmetic refreshDynamicWalletRuntime uses in production.
function createManualClock(start = 0) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe("createBoundedSingleFlight", () => {
  it("reuses the active promise for a concurrent caller within the timeout", () => {
    const clock = createManualClock()
    const flight = createBoundedSingleFlight<boolean>({ timeoutMs: 12_000, now: clock.now })
    const deferred = createDeferred<boolean>()

    const first = flight.run(() => deferred.promise)
    clock.advance(100)
    const second = flight.run(() => Promise.resolve(true))

    expect(first.reused).toBe(false)
    expect(second.reused).toBe(true)
    expect(second.promise).toBe(first.promise)
    expect(second.generation).toBe(first.generation)
  })

  it("a hung promise times out and is removed from the in-flight store", () => {
    const clock = createManualClock()
    const flight = createBoundedSingleFlight<boolean>({ timeoutMs: 12_000, now: clock.now })
    const hungDeferred = createDeferred<boolean>()

    const first = flight.run(() => hungDeferred.promise)
    clock.advance(12_000)
    const second = flight.run(() => Promise.resolve(true))

    expect(first.generation).toBe(1)
    expect(second.reused).toBe(false)
    expect(second.generation).toBe(2)
    expect(second.promise).not.toBe(first.promise)
  })

  it("the next refresh starts a fresh promise instead of reusing the stale one", async () => {
    const clock = createManualClock()
    const flight = createBoundedSingleFlight<string>({ timeoutMs: 12_000, now: clock.now })
    const hungDeferred = createDeferred<string>()

    const first = flight.run(() => hungDeferred.promise)
    clock.advance(20_000)
    const second = flight.run(() => Promise.resolve("fresh"))

    expect(second.reused).toBe(false)
    expect(second.generation).not.toBe(first.generation)
    await expect(second.promise).resolves.toBe("fresh")
    // The fresh attempt resolved immediately and its own generation-guarded cleanup
    // already cleared the record - a subsequent caller starts a new attempt again
    // rather than reusing anything, which is the correct "stopped polling" end state.
    expect(flight.peek()).toBeNull()
  })

  it("an older promise settling later cannot clear a newer in-flight generation", async () => {
    const clock = createManualClock()
    const flight = createBoundedSingleFlight<string>({ timeoutMs: 12_000, now: clock.now })
    const staleDeferred = createDeferred<string>()

    flight.run(() => staleDeferred.promise)
    clock.advance(12_000)
    const fresh = flight.run(() => new Promise<string>(() => {})) // never settles in this test

    expect(flight.peek()?.generation).toBe(fresh.generation)

    // The evicted (stale) promise now resolves after the newer one has already
    // started - its own cleanup must not clear the newer generation's record.
    staleDeferred.resolve("late")
    await staleDeferred.promise

    expect(flight.peek()?.generation).toBe(fresh.generation)
    expect(flight.peek()).not.toBeNull()
  })

  it("polling stops after core success - the record clears once the active generation resolves", async () => {
    const clock = createManualClock()
    const flight = createBoundedSingleFlight<boolean>({ timeoutMs: 12_000, now: clock.now })

    const result = flight.run(() => Promise.resolve(true))
    await result.promise
    // The .finally() callback runs as a microtask right after the promise settles.
    await Promise.resolve()

    expect(flight.peek()).toBeNull()

    // A caller arriving after the active generation cleared starts a genuinely new
    // attempt (higher generation) rather than reusing anything stale.
    const next = flight.run(() => Promise.resolve(true))
    expect(next.reused).toBe(false)
    expect(next.generation).toBe(result.generation + 1)
  })

  it("a rejected operation always permits a future retry", async () => {
    const clock = createManualClock()
    const flight = createBoundedSingleFlight<boolean>({ timeoutMs: 12_000, now: clock.now })

    const failing = flight.run(() => Promise.reject(new Error("boom")))
    await expect(failing.promise).rejects.toThrow("boom")
    await Promise.resolve()

    expect(flight.peek()).toBeNull()
    const retry = flight.run(() => Promise.resolve(true))
    expect(retry.reused).toBe(false)
    await expect(retry.promise).resolves.toBe(true)
  })
})
