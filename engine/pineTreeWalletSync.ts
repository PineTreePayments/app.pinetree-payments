import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getWalletBalances } from "@/database/walletBalances"
import { upsertMerchantAssetBalances } from "@/database/walletOverview"
import { fetchBaseUsdcBalance, fetchSolanaUsdcBalance } from "@/engine/settlementBalances"
import { getMarketPricesUSD } from "@/engine/marketPrices"
import {
  cancelStaleUnsignedWithdrawalReviews,
  listRecentWalletWithdrawalsForActivity,
} from "@/database/walletWithdrawalRequests"
import { listRecentWalletOperationsForActivity } from "@/database/merchantWalletOperations"
import { getPineTreeSpeedConfigStatus } from "@/providers/lightning/speedClient"
import {
  getConnectedAccountBalances,
  SpeedWalletProviderError,
  type SpeedBalanceEntry,
} from "@/providers/lightning/speedWalletManagement"
import { getSpeedWithdrawalFeeReserveSats } from "@/engine/withdrawals/speedWithdrawalQuote"
import { buildPineTreeRailReadiness } from "@/lib/pinetreeRailReadiness"
import { PINETREE_INTERNAL_RAIL_PROVIDER, type PineTreeWalletRail } from "@/lib/pinetreeRailProviderMapping"
import {
  mapWalletWithdrawalRequestStatusToActivity,
  mapWalletOperationStatusToActivity,
} from "@/engine/withdrawals/canonicalWithdrawalStatus"

export type PineTreeBalanceAsset = {
  key: "BASE_ETH" | "BASE_USDC" | "SOLANA_SOL" | "SOLANA_USDC" | "BTC"
  rail: "base" | "solana" | "bitcoin"
  asset: "ETH" | "USDC" | "SOL" | "BTC"
  network: "base" | "solana" | "bitcoin_lightning"
  provider: "dynamic" | "speed"
  totalBalance: string | null
  availableToWithdraw: string | null
  reservedFee: string
  decimals: number
  source: "chain_rpc" | "speed_balances" | "database_snapshot" | "none"
  balance: number | string | null
  usdValue: number | null
  lastSyncedAt: string | null
  status: "synced" | "cached" | "pending_sync" | "config_missing" | "unavailable" | "stale"
}

export type PineTreeNormalizedRail = {
  rail: PineTreeWalletRail
  display_name: "Base" | "Solana" | "Bitcoin"
  connected: boolean
  balance: {
    asset: "USDC" | "BTC"
    amount: string | null
    usd_value: string | null
    status: PineTreeBalanceAsset["status"]
  }
  withdrawal_available: boolean
}

export type PineTreeWalletSyncResult = {
  readiness: {
    base: boolean
    solana: boolean
    bitcoin: boolean
  }
  balances: {
    base: PineTreeBalanceAsset[]
    solana: PineTreeBalanceAsset[]
    bitcoin: PineTreeBalanceAsset[]
  }
  canonicalBalances: PineTreeBalanceAsset[]
  status: "missing" | "pending" | "ready" | "needs_attention"
  total_balance_usd: string | null
  rails: PineTreeNormalizedRail[]
  totalUsd: number | null
  lastSyncedAt: string | null
  recentActivity: Array<{
    id: string
    label: string
    rail: "base" | "solana" | "bitcoin"
    status: string
    createdAt: string
    source?: "manual" | "saved_address" | "automatic_sweep"
  }>
}

const BALANCE_DEFS = [
  { key: "BASE_ETH", rail: "base", asset: "ETH", network: "base", provider: "dynamic", decimals: 18 },
  { key: "BASE_USDC", rail: "base", asset: "USDC", network: "base", provider: "dynamic", decimals: 6 },
  { key: "SOLANA_SOL", rail: "solana", asset: "SOL", network: "solana", provider: "dynamic", decimals: 9 },
  { key: "SOLANA_USDC", rail: "solana", asset: "USDC", network: "solana", provider: "dynamic", decimals: 6 },
  { key: "BTC", rail: "bitcoin", asset: "BTC", network: "bitcoin_lightning", provider: "speed", decimals: 8 },
] as const

function balanceKey(rail: string, asset: string) {
  if (rail === "base" && asset === "ETH") return "BASE_ETH"
  if (rail === "base" && asset === "USDC") return "BASE_USDC"
  if (rail === "solana" && asset === "SOL") return "SOLANA_SOL"
  if (rail === "solana" && asset === "USDC") return "SOLANA_USDC"
  return "BTC"
}

function latestTimestamp(values: Array<string | null>) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(String(value)).getTime())
    .filter((value) => Number.isFinite(value))
  if (dates.length === 0) return null
  return new Date(Math.max(...dates)).toISOString()
}

function formatDecimal(value: number | string | null): string | null {
  if (typeof value === "string") return value
  if (value === null || !Number.isFinite(value)) return null
  return String(value)
}

function decimalString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  return Number.isFinite(value) ? String(value) : null
}

function subtractDecimalStrings(value: string | null, subtract: string, decimals: number): string | null {
  if (value === null) return null
  const normalizedValue = value.trim()
  const normalizedSubtract = subtract.trim()
  if (!/^\d+(?:\.\d+)?$/.test(normalizedValue) || !/^\d+(?:\.\d+)?$/.test(normalizedSubtract)) return value
  const toUnits = (raw: string) => {
    const [whole, fraction = ""] = raw.split(".")
    return BigInt(whole || "0") * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals) || "0")
  }
  const fromUnits = (units: bigint) => {
    if (units <= BigInt(0)) return "0"
    const divisor = BigInt(10) ** BigInt(decimals)
    const whole = units / divisor
    const fraction = (units % divisor).toString().padStart(decimals, "0").replace(/0+$/, "")
    return fraction ? `${whole}.${fraction}` : whole.toString()
  }
  return fromUnits(toUnits(normalizedValue) - toUnits(normalizedSubtract))
}

function formatReserveDecimal(asset: string, baseUnits: bigint): string {
  if (asset === "BTC") {
    const whole = baseUnits / BigInt(100_000_000)
    const fraction = (baseUnits % BigInt(100_000_000)).toString().padStart(8, "0").replace(/0+$/, "")
    return fraction ? `${whole}.${fraction}` : whole.toString()
  }
  return "0"
}

function formatUsd(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  return value.toFixed(2)
}

function normalizeSpeedStatus(value?: string | null): string | null {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized || null
}

function isActiveSpeedAccount(input: {
  speedAccountId?: string | null
  speedStatus?: string | null
}): boolean {
  return String(input.speedAccountId || "").trim().startsWith("acct_") &&
    normalizeSpeedStatus(input.speedStatus) === "active"
}

function walletStatus(input: {
  profileStatus?: string | null
  baseReady: boolean
  solanaReady: boolean
  bitcoinReady: boolean
}): PineTreeWalletSyncResult["status"] {
  if (input.profileStatus === "needs_attention") return "needs_attention"
  if (input.baseReady && input.solanaReady && input.bitcoinReady && input.profileStatus === "ready") return "ready"
  if (!input.profileStatus || input.profileStatus === "not_created") return "missing"
  return "pending"
}

async function fetchSolanaSolBalance(address: string): Promise<number> {
  const rpcUrls = [
    process.env.RPC_URL_SOLANA,
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
  ].filter(Boolean) as string[]

  for (const url of rpcUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBalance",
          params: [address],
        }),
        cache: "no-store",
      })
      const payload = await res.json()
      if (payload.error) continue
      return Number(payload?.result?.value ?? 0) / 1_000_000_000
    } catch {
      // try next endpoint
    }
  }

  throw new Error("Unable to fetch Solana SOL balance.")
}

async function fetchBaseEthBalance(address: string): Promise<number | null> {
  const rpcUrl = String(process.env.BASE_RPC_URL || "").trim()
  if (!rpcUrl) return null

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
    cache: "no-store",
  })
  const payload = await res.json()
  if (payload.error) throw new Error("Unable to fetch Base ETH balance.")
  return Number(BigInt(String(payload.result || "0x0"))) / 1e18
}

async function safeFetchBaseUsdcBalance(address: string): Promise<number | null> {
  if (!String(process.env.BASE_RPC_URL || "").trim()) return null
  return fetchBaseUsdcBalance(address)
}

async function persistSyncedBalances(
  merchantId: string,
  balances: Array<{ asset: string; balance: number | string }>
) {
  if (balances.length === 0) return null
  const timestamp = new Date().toISOString()
  const previousRows = await getWalletBalances(merchantId).catch(() => [])
  const previousByAsset = new Map(previousRows.map((row) => [String(row.asset || "").toUpperCase(), row]))
  await upsertMerchantAssetBalances(merchantId, balances, timestamp)
  for (const balance of balances) {
    const previous = previousByAsset.get(String(balance.asset || "").toUpperCase())
    console.info("[pinetree-balances] BALANCE_SNAPSHOT_UPDATED", {
      merchantId,
      asset: balance.asset,
      network: balance.asset === "BTC" ? "bitcoin_lightning" : String(balance.asset).startsWith("BASE_") ? "base" : "solana",
      provider: balance.asset === "BTC" ? "speed" : "dynamic",
      previousBalance: previous?.balance != null ? String(previous.balance) : null,
      newBalance: String(balance.balance),
      lastSyncedAt: timestamp,
      routeStage: "balance_snapshot_updated",
    })
  }
  console.info("[pinetree-withdrawals] CANONICAL_BALANCE_CACHE_UPDATED", {
    merchantId,
    assetCount: balances.length,
    assets: balances.map((balance) => balance.asset),
    fetchedAt: timestamp,
    routeStage: "canonical_balance_cache_updated",
  })
  return timestamp
}

const BTC_STALE_AFTER_MS = 15 * 60 * 1000

function normalizeBtcDecimal(value: unknown): string | null {
  const raw = String(value ?? "").trim()
  if (!/^\d+(?:\.\d{1,8})?$/.test(raw)) return null
  const [wholeRaw, fractionRaw = ""] = raw.split(".")
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0"
  const fraction = fractionRaw.padEnd(8, "0").slice(0, 8)
  return fraction.replace(/0+$/, "") ? `${whole}.${fraction.replace(/0+$/, "")}` : whole
}

/**
 * Speed's live /balances response can return a SATS amount with a fractional
 * component (e.g. 1596.27, observed against a real connected account) - the
 * ledger apparently tracks sub-satoshi remainders internally, even though a
 * satoshi is Bitcoin's actual smallest spendable unit. Round to the nearest
 * whole satoshi (never truncate, which would systematically undercount)
 * before the exact integer sats -> BTC conversion, so the stored balance
 * never exceeds Bitcoin's 8-decimal-place convention and never desyncs from
 * parseBtcToSats' 8-decimal-place withdrawal validation downstream.
 */
function roundDecimalStringToInteger(raw: string): bigint {
  const [wholePart, fracPart = ""] = raw.split(".")
  const whole = wholePart || "0"
  if (!fracPart) return BigInt(whole)
  return fracPart[0] >= "5" ? BigInt(whole) + BigInt(1) : BigInt(whole)
}

export function satsToBtcDecimal(value: unknown): string | null {
  const raw = String(value ?? "").trim()
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null
  const sats = roundDecimalStringToInteger(raw)
  const whole = sats / BigInt(100_000_000)
  const fraction = (sats % BigInt(100_000_000)).toString().padStart(8, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function normalizeSpeedBitcoinBalance(entries: SpeedBalanceEntry[]): string | null {
  const normalized = entries.map((entry) => ({
    unit: String(entry.target_currency || "").trim().toLowerCase(),
    amount: entry.amount,
  }))
  const sats = normalized.find((entry) => entry.unit === "sats")
  if (sats) return satsToBtcDecimal(sats.amount)
  const btc = normalized.find((entry) => ["btc", "bitcoin", "bitcoin_lightning"].includes(entry.unit))
  return btc ? normalizeBtcDecimal(btc.amount) : null
}

type SpeedBitcoinSyncState = "live" | "failed" | "not_configured" | "cached"

/** Never logs the full account id - only enough to correlate log lines for one account across a session. */
function redactSpeedAccountId(accountId: string): string {
  if (!accountId) return "(none)"
  return accountId.length > 10 ? `${accountId.slice(0, 9)}***${accountId.slice(-4)}` : "acct_***"
}

async function syncSpeedBitcoinBalance(merchantId: string): Promise<SpeedBitcoinSyncState> {
  const profile = await import("@/database/merchantLightningProfiles")
    .then((mod) => mod.getMerchantLightningProfile(merchantId))
    .catch(() => null)
  const accountId = String(profile?.speed_account_id || profile?.speed_connected_account_id || "").trim()
  if (profile?.status !== "ready" || !accountId.startsWith("acct_")) {
    console.info("[pinetree-wallet-sync] speed_bitcoin_balance_not_configured", {
      merchantId,
      lightningProfileExists: Boolean(profile),
      lightningProfileStatus: profile?.status || null,
      speedAccountIdPresent: accountId.startsWith("acct_"),
    })
    return "not_configured"
  }

  try {
    const response = await getConnectedAccountBalances({ merchantId, speedAccountId: accountId })
    const currencyKeys = response.available.map((entry) => String(entry.target_currency || "").toUpperCase())
    const btc = normalizeSpeedBitcoinBalance(response.available)
    if (btc === null) throw new Error("Speed returned no canonical Bitcoin balance")
    await persistSyncedBalances(merchantId, [{ asset: "BTC", balance: btc }])
    console.info("[pinetree-wallet-sync] speed_bitcoin_balance_sync_succeeded", {
      merchantId,
      speedAccountId: redactSpeedAccountId(accountId),
      responseCurrencyKeys: currencyKeys,
      normalizedBtcDecimal: btc,
    })
    return "live"
  } catch (error) {
    // Non-fatal by design (the merchant falls back to their last cached
    // balance) but must not fail silently - this is the only signal that a
    // live Speed BTC sync didn't happen for this merchant this cycle.
    console.warn("[pinetree-wallet-sync] speed_bitcoin_balance_sync_failed", {
      merchantId,
      speedAccountId: redactSpeedAccountId(accountId),
      reason: error instanceof Error ? error.message : "unknown_error",
      providerCategory: error instanceof SpeedWalletProviderError ? error.category : null,
      providerHttpStatus: error instanceof SpeedWalletProviderError ? error.httpStatus : null,
      providerRetryable: error instanceof SpeedWalletProviderError ? error.retryable : null,
    })
    return "failed"
  }
}

export async function syncPineTreeWalletBalances(merchantId: string): Promise<PineTreeWalletSyncResult> {
  const profile = await getPineTreeWalletProfile(merchantId)
  const updates: Array<{ asset: string; balance: number | string }> = []
  const liveSyncedAssetKeys = new Set<string>()

  console.info("[pinetree-balances] BALANCE_SYNC_STARTED", {
    merchantId,
    routeStage: "balance_sync_started",
  })

  if (profile?.solana_address) {
    try {
      const [sol, usdc] = await Promise.all([
        fetchSolanaSolBalance(profile.solana_address),
        fetchSolanaUsdcBalance(profile.solana_address),
      ])
      updates.push({ asset: "SOLANA_SOL", balance: sol })
      updates.push({ asset: "SOLANA_USDC", balance: usdc })
      liveSyncedAssetKeys.add("SOLANA_SOL")
      liveSyncedAssetKeys.add("SOLANA_USDC")
      console.info("[pinetree-balances] BALANCE_SOURCE_RESOLVED", {
        merchantId,
        asset: "SOL",
        network: "solana",
        provider: "dynamic",
        previousBalance: null,
        newBalance: String(sol),
        lastSyncedAt: new Date().toISOString(),
        routeStage: "balance_source_resolved",
      })
      console.info("[pinetree-balances] BALANCE_SOURCE_RESOLVED", {
        merchantId,
        asset: "USDC",
        network: "solana",
        provider: "dynamic",
        previousBalance: null,
        newBalance: String(usdc),
        lastSyncedAt: new Date().toISOString(),
        routeStage: "balance_source_resolved",
      })
    } catch {
      // Keep any previously persisted Solana balances; unsynced assets remain pending.
    }
  }

  if (profile?.base_address && String(process.env.BASE_RPC_URL || "").trim()) {
    try {
      const [eth, usdc] = await Promise.all([
        fetchBaseEthBalance(profile.base_address),
        safeFetchBaseUsdcBalance(profile.base_address),
      ])
      if (eth !== null) {
        updates.push({ asset: "BASE_ETH", balance: eth })
        liveSyncedAssetKeys.add("BASE_ETH")
        console.info("[pinetree-balances] BALANCE_SOURCE_RESOLVED", {
          merchantId,
          asset: "ETH",
          network: "base",
          provider: "dynamic",
          previousBalance: null,
          newBalance: String(eth),
          lastSyncedAt: new Date().toISOString(),
          routeStage: "balance_source_resolved",
        })
      }
      if (usdc !== null) {
        updates.push({ asset: "BASE_USDC", balance: usdc })
        liveSyncedAssetKeys.add("BASE_USDC")
        console.info("[pinetree-balances] BALANCE_SOURCE_RESOLVED", {
          merchantId,
          asset: "USDC",
          network: "base",
          provider: "dynamic",
          previousBalance: null,
          newBalance: String(usdc),
          lastSyncedAt: new Date().toISOString(),
          routeStage: "balance_source_resolved",
        })
      }
    } catch {
      // Base stays pending if the configured RPC cannot return balances.
    }
  }

  await persistSyncedBalances(merchantId, updates)
  const speedBitcoinSyncState = await syncSpeedBitcoinBalance(merchantId)
  if (speedBitcoinSyncState === "live") liveSyncedAssetKeys.add("BTC")
  const snapshot = await getPineTreeWalletBalanceSnapshot(merchantId, speedBitcoinSyncState, { liveSyncedAssetKeys })
  console.info("[pinetree-withdrawals] WALLET_BALANCE_REFRESH_COMPLETED", {
    merchantId,
    baseAssetCount: snapshot.balances.base.length,
    solanaAssetCount: snapshot.balances.solana.length,
    bitcoinAssetCount: snapshot.balances.bitcoin.length,
    lastSyncedAt: snapshot.lastSyncedAt,
    routeStage: "wallet_balance_refresh_completed",
  })
  return snapshot
}

function isBaseRpcConfigured(): boolean {
  return Boolean(String(process.env.BASE_RPC_URL || "").trim())
}

export async function getPineTreeWalletBalanceSnapshot(
  merchantId: string,
  speedBitcoinSyncState: SpeedBitcoinSyncState = "cached",
  options?: { liveSyncedAssetKeys?: Set<string> }
): Promise<PineTreeWalletSyncResult> {
  console.info("[pinetree-withdrawals] CANONICAL_WALLET_READ_STARTED", {
    merchantId,
    speedBitcoinSyncState,
    routeStage: "canonical_wallet_read_started",
  })
  await cancelStaleUnsignedWithdrawalReviews(merchantId).catch(() => ({ canceled: 0 }))
  const [profile, rows, prices, recentWithdrawals, recentOperations, providers, lightningProfile] = await Promise.all([
    getPineTreeWalletProfile(merchantId),
    getWalletBalances(merchantId),
    getMarketPricesUSD(),
    listRecentWalletWithdrawalsForActivity(merchantId, 10).catch(() => []),
    // Bitcoin withdrawals live in merchant_wallet_operations, not
    // wallet_withdrawal_requests - without this they would never appear in
    // Activity at all.
    listRecentWalletOperationsForActivity(merchantId, 10).catch(() => []),
    import("@/database/merchants").then((mod) => mod.getMerchantProviders(merchantId)).catch(() => []),
    import("@/database/merchantLightningProfiles").then((mod) => mod.getMerchantLightningProfile(merchantId)).catch(() => null),
  ])
  const { SPEED_PROVIDER_NAME } = await import("@/database/merchantProviders").catch(() => ({ SPEED_PROVIDER_NAME: "lightning_speed" }))
  const speedProvider = providers.find((provider) => String(provider.provider || "").toLowerCase().trim() === SPEED_PROVIDER_NAME)
  const speedCredentials = (speedProvider?.credentials || {}) as {
    speed_account_id?: string
    account_id?: string
    setup_status?: string
  }
  const speedConfig = getPineTreeSpeedConfigStatus()
  const speedAccountId = String(lightningProfile?.speed_account_id || speedCredentials.speed_account_id || speedCredentials.account_id || "").trim()
  const speedStatus = lightningProfile?.speed_connected_account_status || speedCredentials.setup_status || ""
  const speedAccountReady = isActiveSpeedAccount({ speedAccountId, speedStatus })
  const railReadiness = buildPineTreeRailReadiness({
    providers,
    walletProfile: profile,
    speed: {
      configured: speedConfig.configured,
      accountReady: speedAccountReady,
      payoutReady: Boolean(speedAccountReady && profile?.btc_payout_enabled),
      status: lightningProfile?.status || String(speedCredentials.setup_status || "")
    }
  })
  const byAsset = new Map(rows.map((row) => [String(row.asset || "").toUpperCase(), row]))
  const baseConfigured = isBaseRpcConfigured()
  const hasBaseAddress = Boolean(profile?.base_address)

  const toBalance = (def: typeof BALANCE_DEFS[number]): PineTreeBalanceAsset => {
    const key = balanceKey(def.rail, def.asset)
    const row = byAsset.get(key)
    const rowBalance = row ? row.balance ?? 0 : null
    const balance = def.rail === "bitcoin"
      ? (row ? String(row.balance ?? "0") : null)
      : row
        ? Number(rowBalance)
        : null
    const price = def.asset === "USDC" ? 1 : def.asset === "SOL" ? prices.SOL : def.asset === "ETH" ? prices.ETH : prices.BTC

    let status: PineTreeBalanceAsset["status"]
    const updatedAtMs = row?.last_updated ? new Date(row.last_updated).getTime() : Number.NaN
    const stale = !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > BTC_STALE_AFTER_MS
    const wasLiveSynced = options?.liveSyncedAssetKeys?.has(key) === true
    if (def.rail === "bitcoin") {
      status = !speedAccountReady
        ? "pending_sync"
        : speedBitcoinSyncState === "live" && row
          ? "synced"
          : row
            ? stale ? "stale" : "cached"
            : "unavailable"
    } else if (row) {
      status = wasLiveSynced ? "synced" : stale ? "stale" : "cached"
    } else if (def.rail === "base" && hasBaseAddress && !baseConfigured) {
      status = "config_missing"
    } else {
      status = "pending_sync"
    }
    const totalBalance = decimalString(balance)
    const reservedFee = def.asset === "BTC" ? formatReserveDecimal("BTC", getSpeedWithdrawalFeeReserveSats("lightning")) : "0"
    const availableToWithdraw = status === "synced" || status === "cached" || status === "stale"
      ? subtractDecimalStrings(totalBalance, reservedFee, def.decimals)
      : null
    const source: PineTreeBalanceAsset["source"] =
      status === "synced"
        ? def.rail === "bitcoin" ? "speed_balances" : "chain_rpc"
        : row
          ? "database_snapshot"
          : "none"

    return {
      key,
      rail: def.rail,
      asset: def.asset,
      network: def.network,
      provider: def.provider,
      totalBalance,
      availableToWithdraw,
      reservedFee,
      decimals: def.decimals,
      source,
      balance,
      usdValue: balance === null
        ? null
        : Number(balance) * price,
      lastSyncedAt: row?.last_updated || null,
      status,
    }
  }

  const all = BALANCE_DEFS.map(toBalance)
  console.info("[pinetree-withdrawals] CANONICAL_WALLET_BALANCE_SOURCE_RESOLVED", {
    merchantId,
    assetCount: all.length,
    syncedCount: all.filter((item) => item.status === "synced").length,
    knownBalanceCount: all.filter((item) => item.usdValue !== null).length,
    routeStage: "canonical_wallet_balance_source_resolved",
  })
  for (const balance of all) {
    console.info("[pinetree-withdrawals] CANONICAL_BALANCE_RESOLVED", {
      merchantId,
      rail: balance.rail,
      asset: balance.asset,
      key: balance.key,
      status: balance.status,
      balancePresent: balance.balance !== null,
      lastSyncedAt: balance.lastSyncedAt,
      stale: balance.status === "stale",
      routeStage: "canonical_balance_resolved",
    })
    console.info("[pinetree-balances] BALANCE_SOURCE_RESOLVED", {
      merchantId,
      asset: balance.asset,
      network: balance.network,
      provider: balance.provider,
      previousBalance: null,
      newBalance: balance.totalBalance,
      lastSyncedAt: balance.lastSyncedAt,
      source: balance.source,
      routeStage: "balance_source_resolved",
    })
  }
  // Sum every asset with a KNOWN balance (synced this cycle, cached from a
  // prior sync, or stale-but-still-the-last-known-value) - not just assets
  // that happened to be freshly re-synced on this exact call. Previously this
  // excluded "cached"/"stale" items, so total_balance_usd could silently
  // disagree with the per-rail sums the client computes from the same
  // `balances` array (WalletOverviewSummary sums every item with a usdValue,
  // regardless of status) - the same withdrawal screen could show a "Total
  // Balance" that didn't equal the sum of the rail rows directly below it.
  const withKnownBalance = all.filter((item) => item.usdValue !== null)
  const totalUsd = withKnownBalance.length > 0
    ? withKnownBalance.reduce((sum, item) => sum + Number(item.usdValue || 0), 0)
    : null

  const withdrawalActivity = recentWithdrawals.map((wd) => ({
    id: wd.id,
    label: `${wd.source === "automatic_sweep" ? "Auto-swept" : "Sent"} ${wd.amount_decimal} ${wd.asset}`,
    rail: wd.rail,
    status: mapWalletWithdrawalRequestStatusToActivity(wd.status, Boolean(wd.tx_hash)),
    createdAt: wd.created_at,
    source: wd.source,
  }))

  // Bitcoin/Speed withdrawals live in a separate ledger table
  // (merchant_wallet_operations) from Base/Solana's wallet_withdrawal_requests,
  // so they need their own query - but both go through the same canonical
  // status mapper (engine/withdrawals/canonicalWithdrawalStatus.ts) so a
  // withdrawal can never render a different status here than reconciliation
  // just persisted for it.
  const operationActivity = recentOperations.map((op) => ({
    id: op.id,
    label: `${op.source === "automatic_sweep" ? "Auto-swept" : "Sent"} ${satsToBtcDecimal(op.amount_base_units) ?? "0"} BTC`,
    rail: "bitcoin" as const,
    status: mapWalletOperationStatusToActivity(op.status, {
      createdAt: op.created_at,
      updatedAt: op.updated_at,
      providerReference: op.provider_reference,
      providerTransactionId: op.provider_transaction_id,
      submittedAt: op.submitted_at,
    }),
    createdAt: op.created_at,
    source: op.source,
  }))

  const recentActivity = [...withdrawalActivity, ...operationActivity]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15)

  console.info("[pinetree-withdrawals] CANONICAL_WALLET_ACTIVITY_SOURCE_RESOLVED", {
    merchantId,
    walletWithdrawalRequestCount: withdrawalActivity.length,
    walletOperationCount: operationActivity.length,
    mergedCount: recentActivity.length,
    routeStage: "canonical_wallet_activity_source_resolved",
  })

  const baseReady = railReadiness.base.walletProvisioned
  const solanaReady = railReadiness.solana.walletProvisioned
  const bitcoinReady = railReadiness.bitcoin_lightning.walletProvisioned
  const normalizedRails: PineTreeNormalizedRail[] = [
    {
      rail: "base",
      display_name: "Base",
      connected: baseReady,
      balance: (() => {
        const usdc = all.find((item) => item.rail === "base" && item.asset === "USDC")
        return {
          asset: "USDC" as const,
          amount: formatDecimal(usdc?.balance ?? null),
          usd_value: formatUsd(usdc?.usdValue ?? null),
          status: usdc?.status ?? "pending_sync",
        }
      })(),
      withdrawal_available: railReadiness.base.withdrawalReady,
    },
    {
      rail: "solana",
      display_name: "Solana",
      connected: solanaReady,
      balance: (() => {
        const usdc = all.find((item) => item.rail === "solana" && item.asset === "USDC")
        return {
          asset: "USDC" as const,
          amount: formatDecimal(usdc?.balance ?? null),
          usd_value: formatUsd(usdc?.usdValue ?? null),
          status: usdc?.status ?? "pending_sync",
        }
      })(),
      withdrawal_available: railReadiness.solana.withdrawalReady,
    },
    {
      rail: "bitcoin",
      display_name: "Bitcoin",
      connected: bitcoinReady,
      balance: {
        asset: "BTC",
        amount: formatDecimal(all.find((item) => item.key === "BTC")?.balance ?? null),
        usd_value: formatUsd(all.find((item) => item.key === "BTC")?.usdValue ?? null),
        status: all.find((item) => item.key === "BTC")?.status ?? (bitcoinReady ? "unavailable" : "pending_sync"),
      },
      withdrawal_available: railReadiness.bitcoin_lightning.withdrawalReady,
    },
  ]
  void PINETREE_INTERNAL_RAIL_PROVIDER

  console.info("[pinetree-withdrawals] CANONICAL_WALLET_BALANCES_RETURNED", {
    merchantId,
    totalUsd,
    railTotalsUsd: {
      base: normalizedRails.find((r) => r.rail === "base") ? all.filter((i) => i.rail === "base").reduce((s, i) => s + Number(i.usdValue || 0), 0) : null,
      solana: all.filter((i) => i.rail === "solana").reduce((s, i) => s + Number(i.usdValue || 0), 0),
      bitcoin: all.filter((i) => i.rail === "bitcoin").reduce((s, i) => s + Number(i.usdValue || 0), 0),
    },
    activityCount: recentActivity.length,
    routeStage: "canonical_wallet_balances_returned",
  })

  return {
    readiness: {
      base: baseReady,
      solana: solanaReady,
      bitcoin: bitcoinReady,
    },
    status: walletStatus({
      profileStatus: profile?.status,
      baseReady,
      solanaReady,
      bitcoinReady,
    }),
    total_balance_usd: formatUsd(totalUsd),
    rails: normalizedRails,
    balances: {
      base: all.filter((item) => item.rail === "base"),
      solana: all.filter((item) => item.rail === "solana"),
      bitcoin: all.filter((item) => item.rail === "bitcoin"),
    },
    canonicalBalances: all,
    totalUsd,
    lastSyncedAt: latestTimestamp(all.map((item) => item.lastSyncedAt)),
    recentActivity,
  }
}
