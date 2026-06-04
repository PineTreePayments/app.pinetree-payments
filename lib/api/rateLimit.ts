/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * Current implementation: in-process Map, one instance per serverless function
 * invocation.  State does not survive restarts and is not shared across Vercel
 * function instances.
 *
 * This is intentional for the current scale.  The interface is stable so the
 * backing store can be swapped to Redis without changing callers.
 *
 * ── Upstash Redis upgrade path ───────────────────────────────────────────────
 * When you need shared state across instances:
 *
 * 1. Install:  npm install @upstash/ratelimit @upstash/redis
 *
 * 2. Create a wrapper that satisfies RateLimiter:
 *
 *    import { Ratelimit } from "@upstash/ratelimit"
 *    import { Redis }     from "@upstash/redis"
 *
 *    export function makeRedisRateLimiter(opts: {
 *      windowMs: number
 *      maxRequests: number
 *    }): RateLimiter {
 *      const ratelimit = new Ratelimit({
 *        redis: Redis.fromEnv(),
 *        limiter: Ratelimit.slidingWindow(
 *          opts.maxRequests,
 *          `${opts.windowMs}ms`
 *        ),
 *      })
 *      return {
 *        async check(key) {
 *          const { success, reset } = await ratelimit.limit(key)
 *          return success
 *            ? { allowed: true }
 *            : { allowed: false, retryAfterMs: reset - Date.now() }
 *        },
 *        async reset(key) {
 *          // Upstash does not expose a single-key reset; delete the key directly.
 *          await Redis.fromEnv().del(key)
 *        },
 *      }
 *    }
 *
 * 3. Swap makeRateLimiter → makeRedisRateLimiter at each call site.
 *    No changes needed inside the route handlers — they only use check/reset.
 *
 * Required env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   const limiter = makeRateLimiter({ windowMs: 60_000, maxRequests: 30 })
 *   const result  = limiter.check("some-key")
 *   if (!result.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
 *   // On success: limiter.reset("some-key")  // optional — clears failure count
 */

type Entry = { timestamps: number[] }

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number }

export interface RateLimiter {
  /** Record one attempt and return whether it is within the limit. */
  check: (key: string) => RateLimitResult
  /**
   * Clear the rate-limit counter for a key.
   * Call this after a successful auth action so a user who previously failed
   * N times doesn't get locked out again during the same window.
   */
  reset: (key: string) => void
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

    reset(key: string): void {
      store.delete(key)
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
