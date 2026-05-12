function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || "").trim()
    if (value) return value
  }
  return ""
}

function normalizeApiBaseUrl(value?: string): string {
  return String(value || "https://api.tryspeed.com").replace(/\/+$/, "")
}

function buildSpeedAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
}

function readBalanceAmount(raw: unknown, targetCurrency: string): number {
  const available = raw && typeof raw === "object"
    ? (raw as { available?: unknown }).available
    : null

  if (!Array.isArray(available)) return 0

  const match = available.find((entry) => {
    if (!entry || typeof entry !== "object") return false
    const currency = String((entry as { target_currency?: unknown }).target_currency || "")
      .toUpperCase()
      .trim()
    return currency === targetCurrency
  })

  if (!match || typeof match !== "object") return 0

  const amount = Number((match as { amount?: unknown }).amount ?? 0)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

export async function getSpeedAccountBalanceBtc(speedAccountId: string): Promise<number> {
  const accountId = String(speedAccountId || "").trim()
  const providerKey = readEnv("SPEED_API_KEY", "PINETREE_LIGHTNING_PROVIDER_KEY")
  const apiBaseUrl =
    readEnv("SPEED_API_BASE_URL", "PINETREE_LIGHTNING_API_BASE_URL") ||
    "https://api.tryspeed.com"

  if (!accountId || !providerKey) return 0

  const response = await fetch(`${normalizeApiBaseUrl(apiBaseUrl)}/balances`, {
    method: "GET",
    headers: {
      Authorization: buildSpeedAuthHeader(providerKey),
      "Content-Type": "application/json",
      "speed-version": "2022-10-15",
      "speed-account": accountId
    },
    cache: "no-store"
  })

  if (!response.ok) {
    console.warn("[lightning/speed] balance lookup failed", {
      status: response.status,
      accountId
    })
    return 0
  }

  const data = await response.json().catch(() => null)
  const sats = readBalanceAmount(data, "SATS")

  return sats / 100_000_000
}
