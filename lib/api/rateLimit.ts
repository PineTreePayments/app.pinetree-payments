/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * Limitations (intentional for this pass):
 *  - State is per-process and does not survive restarts or scale across
 *    Vercel function instances.  A Redis-backed limiter is the right
 *    long-term solution, but this provides meaningful protection for
 *    single-instance and low-concurrency deployments.
 *  - Keys auto-expire: entries older than 2× the window are pruned on
 *    each check so the Map does not grow unbounded.
 *
 * Usage:
 *   const limiter = makeRateLimiter({ windowMs: 60_000, maxRequests: 30 })
 *   const result  = limiter.check("some-key")
 *   if (!result.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
 */

type Entry = { timestamps: number[] }

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number }

export interface RateLimiter {
  check: (key: string) => RateLimitResult
}

export function makeRateLimiter(opts: {
  windowMs: number
  maxRequests: number
}): RateLimiter {
  const { windowMs, maxRequests } = opts
  const store = new Map<string, Entry>()

  function prune(now: number) {
    const cutoff = now - windowMs * 2
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
      if (entry.timestamps.length === 0) store.delete(key)
    }
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now()
      prune(now)

      const windowStart = now - windowMs
      const entry = store.get(key) ?? { timestamps: [] }
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart)

      if (entry.timestamps.length >= maxRequests) {
        const oldest = entry.timestamps[0]
        const retryAfterMs = oldest + windowMs - now
        store.set(key, entry)
        return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) }
      }

      entry.timestamps.push(now)
      store.set(key, entry)
      return { allowed: true }
    },
  }
}

/**
 * Extract a best-effort IP string from the request for use as a rate-limit key.
 * Falls back to "unknown" so callers never receive null.
 */
export function getRequestIp(req: { headers: { get: (name: string) => string | null } }): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  )
}
