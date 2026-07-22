export function getDeploymentBuildId(): string {
  const value =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ||
    process.env.BUILD_ID ||
    process.env.NEXT_PUBLIC_BUILD_TIMESTAMP ||
    "unavailable"
  const normalized = String(value).trim()
  if (!normalized) return "unavailable"
  return normalized.length > 12 ? normalized.slice(0, 12) : normalized
}
