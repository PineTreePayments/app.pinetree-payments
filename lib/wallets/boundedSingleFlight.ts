// Reference implementation of the bounded single-flight contract used by
// refreshDynamicWalletRuntime in app/dashboard/wallet-setup/page.tsx: only one
// operation per key runs at a time, a caller that arrives while one is active reuses
// it, but an operation older than `timeoutMs` is treated as stale and evicted so the
// next caller starts a fresh attempt instead of waiting on a hung promise forever.
//
// A generation id is attached to every attempt so that when a stale, evicted promise
// eventually settles, its own cleanup can detect it is no longer the active attempt
// and skip clearing a newer one out from under it.
export type BoundedSingleFlightRecord<T> = {
  promise: Promise<T>
  generation: number
  startedAt: number
}

export type BoundedSingleFlightResult<T> = {
  promise: Promise<T>
  reused: boolean
  stale: boolean
  generation: number
  ageMs: number
}

export function createBoundedSingleFlight<T>(options: { timeoutMs: number; now?: () => number }) {
  const now = options.now ?? (() => Date.now())
  let generationCounter = 0
  let active: BoundedSingleFlightRecord<T> | null = null

  function run(startRun: () => Promise<T>): BoundedSingleFlightResult<T> {
    const existing = active
    if (existing) {
      const ageMs = now() - existing.startedAt
      const stale = ageMs >= options.timeoutMs
      if (!stale) {
        return { promise: existing.promise, reused: true, stale: false, generation: existing.generation, ageMs }
      }
      // Evict the stale record. The old promise keeps running in the background (it
      // cannot be cancelled), but this store no longer waits on it.
      active = null
    }

    const generation = ++generationCounter
    const startedAt = now()
    const promise = startRun().finally(() => {
      if (active && active.generation === generation) {
        active = null
      }
    })
    active = { promise, generation, startedAt }
    return { promise, reused: false, stale: false, generation, ageMs: 0 }
  }

  function peek(): BoundedSingleFlightRecord<T> | null {
    return active
  }

  return { run, peek }
}
