import { deleteExpiredCompletedApiIdempotencyClaims } from "@/database/apiIdempotencyClaims"

/**
 * Manual/internal maintenance helper. Vercel cron is not available on the
 * current plan, so callers must invoke the protected maintenance route or this
 * function explicitly. Unresolved claims are intentionally retained.
 */
export async function cleanupExpiredApiIdempotencyClaims(now = new Date()) {
  const deletedCount = await deleteExpiredCompletedApiIdempotencyClaims(
    now.toISOString()
  )
  return {
    deletedCount,
    completedAt: new Date().toISOString(),
  }
}
