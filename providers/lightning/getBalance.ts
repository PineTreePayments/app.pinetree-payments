function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || "").trim()
    if (value) return value
  }
  return ""
}

export type SpeedBalanceDiagnostics = {
  hasApiKey: boolean
  baseUrl: string
  speedAccountIdMasked: string
  httpStatus: number | null
  merchantContextStatus: number | null
  platformFallbackStatus: number | null
  balanceSource: "merchant_account" | "platform_account_fallback" | "none"
  rawBalanceKeys: string[]
  balancesFound: string[]
  rawNumericAmount: number | null
  satsAmount: number
  btcAmount: number
  error?: string
}

function normalizeApiBaseUrl(value?: string): string {
  return String(value || "https://api.tryspeed.com").replace(/\/+$/, "")
}

export function maskSpeedAccountId(value: string): string {
  const trimmed = String(value || "").trim()
  if (!trimmed) return ""
  if (trimmed.length <= 10) return `${trimmed.slice(0, 4)}...`
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`
}

function buildSpeedAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>).sort()
}

function readStringField(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = value[key]
    if (typeof raw === "string" && raw.trim()) return raw.trim()
  }
  return ""
}

function readNumberField(value: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = value[key]
    const amount = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN
    if (Number.isFinite(amount)) return amount
  }
  return null
}

function normalizeCurrency(value: string): string {
  return value.toUpperCase().trim()
}

function collectBalanceEntries(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => collectBalanceEntries(entry))
  }

  if (!raw || typeof raw !== "object") return []

  const obj = raw as Record<string, unknown>
  const entries: Array<Record<string, unknown>> = []
  const directCurrency = readStringField(obj, [
    "target_currency",
    "currency",
    "asset",
    "unit"
  ])
  const directAmount = readNumberField(obj, [
    "available_balance",
    "available_amount",
    "balance",
    "amount"
  ])

  if (directCurrency && directAmount !== null) {
    entries.push(obj)
  }

  for (const key of ["available", "balances", "data", "items", "results"]) {
    entries.push(...collectBalanceEntries(obj[key]))
  }

  for (const key of ["available_balance", "balance"]) {
    const nested = obj[key]
    if (nested && typeof nested === "object") {
      entries.push(...collectBalanceEntries(nested))
    }
  }

  return entries
}

function parseBalanceDiagnostics(raw: unknown): Pick<
  SpeedBalanceDiagnostics,
  "rawBalanceKeys" | "balancesFound" | "rawNumericAmount" | "satsAmount" | "btcAmount"
> {
  const entries = collectBalanceEntries(raw)
  const balancesFound = Array.from(new Set(
    entries
      .map((entry) => normalizeCurrency(readStringField(entry, [
        "target_currency",
        "currency",
        "asset",
        "unit"
      ])))
      .filter(Boolean)
  ))

  let rawNumericAmount: number | null = null
  let satsAmount = 0

  for (const entry of entries) {
    const currency = normalizeCurrency(readStringField(entry, [
      "target_currency",
      "currency",
      "asset",
      "unit"
    ]))
    const amount = readNumberField(entry, [
      "available_balance",
      "available_amount",
      "balance",
      "amount"
    ])

    if (amount === null) continue

    if (currency === "SATS" || currency === "SAT" || currency === "Satoshi".toUpperCase()) {
      rawNumericAmount = amount
      satsAmount = Math.max(0, amount)
      break
    }

    if (currency === "BTC" || currency === "BITCOIN") {
      rawNumericAmount = amount
      satsAmount = Math.max(0, amount) * 100_000_000
      break
    }
  }

  return {
    rawBalanceKeys: objectKeys(raw),
    balancesFound,
    rawNumericAmount,
    satsAmount,
    btcAmount: satsAmount / 100_000_000
  }
}

function logSpeedBalanceDiagnostics(label: string, diagnostics: SpeedBalanceDiagnostics) {
  console.info(label, {
    hasApiKey: diagnostics.hasApiKey,
    baseUrl: diagnostics.baseUrl,
    speedAccountIdMasked: diagnostics.speedAccountIdMasked,
    httpStatus: diagnostics.httpStatus,
    merchantContextStatus: diagnostics.merchantContextStatus,
    platformFallbackStatus: diagnostics.platformFallbackStatus,
    balanceSource: diagnostics.balanceSource,
    rawBalanceKeys: diagnostics.rawBalanceKeys,
    balancesFound: diagnostics.balancesFound,
    rawNumericAmount: diagnostics.rawNumericAmount,
    satsAmount: diagnostics.satsAmount,
    btcAmount: diagnostics.btcAmount,
    error: diagnostics.error
  })
}

async function fetchSpeedBalance(args: {
  baseUrl: string
  providerKey: string
  speedAccountId?: string
}): Promise<{
  status: number
  ok: boolean
  parsed: Pick<
    SpeedBalanceDiagnostics,
    "rawBalanceKeys" | "balancesFound" | "rawNumericAmount" | "satsAmount" | "btcAmount"
  >
}> {
  const headers: Record<string, string> = {
    Authorization: buildSpeedAuthHeader(args.providerKey),
    "Content-Type": "application/json",
    "speed-version": "2022-10-15"
  }

  if (args.speedAccountId) {
    headers["speed-account"] = args.speedAccountId
  }

  const response = await fetch(`${args.baseUrl}/balances`, {
    method: "GET",
    headers,
    cache: "no-store"
  })

  const data = await response.json().catch(() => null)

  return {
    status: response.status,
    ok: response.ok,
    parsed: parseBalanceDiagnostics(data)
  }
}

function isAuthFailure(status: number | null): boolean {
  return status === 401 || status === 403
}

export async function getSpeedAccountBalanceDiagnostics(
  speedAccountId: string
): Promise<SpeedBalanceDiagnostics> {
  const accountId = String(speedAccountId || "").trim()
  const providerKey = readEnv("SPEED_API_KEY", "PINETREE_LIGHTNING_PROVIDER_KEY")
  const apiBaseUrl =
    readEnv("SPEED_API_BASE_URL", "PINETREE_LIGHTNING_API_BASE_URL") ||
    "https://api.tryspeed.com"
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl)
  const baseline: SpeedBalanceDiagnostics = {
    hasApiKey: Boolean(providerKey),
    baseUrl,
    speedAccountIdMasked: maskSpeedAccountId(accountId),
    httpStatus: null,
    merchantContextStatus: null,
    platformFallbackStatus: null,
    balanceSource: "none",
    rawBalanceKeys: [],
    balancesFound: [],
    rawNumericAmount: null,
    satsAmount: 0,
    btcAmount: 0
  }

  if (!accountId) {
    return { ...baseline, error: "Missing Speed account ID" }
  }

  if (!providerKey) {
    return { ...baseline, error: "Missing SPEED_API_KEY" }
  }

  try {
    const merchantAttempt = await fetchSpeedBalance({
      baseUrl,
      providerKey,
      speedAccountId: accountId
    })

    if (merchantAttempt.ok || !isAuthFailure(merchantAttempt.status)) {
      const diagnostics: SpeedBalanceDiagnostics = {
        ...baseline,
        ...merchantAttempt.parsed,
        httpStatus: merchantAttempt.status,
        merchantContextStatus: merchantAttempt.status,
        balanceSource: merchantAttempt.ok ? "merchant_account" : "none",
        error: merchantAttempt.ok ? undefined : "Speed balance lookup failed"
      }

      logSpeedBalanceDiagnostics("[lightning/speed] balance diagnostics", diagnostics)
      return diagnostics
    }

    const platformAttempt = await fetchSpeedBalance({
      baseUrl,
      providerKey
    })

    const diagnostics: SpeedBalanceDiagnostics = {
      ...baseline,
      ...platformAttempt.parsed,
      httpStatus: platformAttempt.status,
      merchantContextStatus: merchantAttempt.status,
      platformFallbackStatus: platformAttempt.status,
      balanceSource: platformAttempt.ok ? "platform_account_fallback" : "none",
      error: platformAttempt.ok
        ? undefined
        : "Speed balance lookup failed after merchant context auth failure"
    }

    logSpeedBalanceDiagnostics("[lightning/speed] balance diagnostics", diagnostics)
    return diagnostics
  } catch (error) {
    const diagnostics = {
      ...baseline,
      error: error instanceof Error ? error.message : "Speed balance lookup failed"
    }
    logSpeedBalanceDiagnostics("[lightning/speed] balance diagnostics", diagnostics)
    return diagnostics
  }
}

export async function getSpeedAccountBalanceBtc(speedAccountId: string): Promise<number> {
  const diagnostics = await getSpeedAccountBalanceDiagnostics(speedAccountId)
  return diagnostics.btcAmount
}
