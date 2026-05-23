function readSafeHttpsUrl(value: string): string | null {
  const raw = String(value || "").trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

export function getConfiguredSpeedDashboardUrl(): string | null {
  return readSafeHttpsUrl(process.env.SPEED_DASHBOARD_URL || "")
}

export function getConfiguredSpeedBankSetupUrl(): string | null {
  return readSafeHttpsUrl(process.env.SPEED_BANK_SETUP_URL || "")
}
