import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runWithBoundedTimeout } from "@/lib/wallets/boundedProviderCall"

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("runWithBoundedTimeout", () => {
  it("a fulfilled operation before the deadline resolves immediately with its value", async () => {
    const call = runWithBoundedTimeout(() => Promise.resolve("base-created"), 25_000)
    const outcome = await call.result
    expect(outcome).toEqual({ status: "fulfilled", value: "base-created" })
  })

  it("a rejected operation before the deadline resolves as rejected, not timeout", async () => {
    const call = runWithBoundedTimeout(() => Promise.reject(new Error("provider down")), 25_000)
    const outcome = await call.result
    expect(outcome.status).toBe("rejected")
    if (outcome.status === "rejected") {
      expect((outcome.reason as Error).message).toBe("provider down")
    }
  })

  it("a hung Base-chain-shaped operation stops being awaited after the 25s deadline", async () => {
    const hung = createDeferred<unknown>()
    const call = runWithBoundedTimeout(() => hung.promise, 25_000)

    const resultPromise = call.result
    await vi.advanceTimersByTimeAsync(24_999)
    // Not timed out yet - the race is still pending.
    let settledEarly = false
    resultPromise.then(() => {
      settledEarly = true
    })
    await Promise.resolve()
    expect(settledEarly).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const outcome = await resultPromise
    expect(outcome).toEqual({ status: "timeout" })
  })

  it("a hung Solana-chain-shaped operation stops being awaited after the 25s deadline", async () => {
    const hung = createDeferred<unknown>()
    const call = runWithBoundedTimeout(() => hung.promise, 25_000)
    await vi.advanceTimersByTimeAsync(25_000)
    const outcome = await call.result
    expect(outcome).toEqual({ status: "timeout" })
  })

  it("settlement resolves independently once the late operation finally settles, even after the race already reported a timeout", async () => {
    const late = createDeferred<string>()
    const call = runWithBoundedTimeout(() => late.promise, 25_000)
    await vi.advanceTimersByTimeAsync(25_000)
    const timedOut = await call.result
    expect(timedOut).toEqual({ status: "timeout" })

    late.resolve("solana-created-late")
    const settled = await call.settlement
    expect(settled).toEqual({ status: "fulfilled", value: "solana-created-late" })
  })

  it("does not report timeout for an operation that settles just under the deadline", async () => {
    const call = runWithBoundedTimeout(() => Promise.resolve("just-in-time"), 25_000)
    const outcome = await call.result
    expect(outcome.status).toBe("fulfilled")
  })
})
