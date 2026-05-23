export function getConfiguredSpeedDashboardUrl(): string | null {
  const raw = String(process.env.SPEED_DASHBOARD_URL || "").trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}
