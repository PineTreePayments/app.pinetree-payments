import { deleteExpiredCompletedApiIdempotencyClaims } from "@/database/apiIdempotencyClaims"

/**
 * Manual/internal maintenance helper. No scheduled job currently invokes this
 * cleanup, so callers must use its protected route or this function explicitly.
 * Unresolved claims are intentionally retained.
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
