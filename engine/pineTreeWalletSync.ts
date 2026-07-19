import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getWalletBalances } from "@/database/walletBalances"
import { upsertMerchantAssetBalances } from "@/database/walletOverview"
import { fetchBaseUsdcBalance, fetchSolanaUsdcBalance } from "@/engine/settlementBalances"
import { getMarketPricesUSD } from "@/engine/marketPrices"
import {
  cancelStaleUnsignedWithdrawalReviews,
  listRecentWalletWithdrawalsForActivity,
} from "@/database/walletWithdrawalRequests"
import { getPineTreeSpeedConfigStatus } from "@/providers/lightning/speedClient"
import { getConnectedAccountBalances, type SpeedBalanceEntry } from "@/providers/lightning/speedWalletManagement"
import { buildPineTreeRailReadiness } from "@/lib/pinetreeRailReadiness"
import { PINETREE_INTERNAL_RAIL_PROVIDER, type PineTreeWalletRail } from "@/lib/pinetreeRailProviderMapping"

export type PineTreeBalanceAsset = {
  key: "BASE_ETH" | "BASE_USDC" | "SOLANA_SOL" | "SOLANA_USDC" | "BTC"
  rail: "base" | "solana" | "bitcoin"
  asset: "ETH" | "USDC" | "SOL" | "BTC"
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
  }>
}

const BALANCE_DEFS = [
  { key: "BASE_ETH", rail: "base", asset: "ETH" },
  { key: "BASE_USDC", rail: "base", asset: "USDC" },
  { key: "SOLANA_SOL", rail: "solana", asset: "SOL" },
  { key: "SOLANA_USDC", rail: "solana", asset: "USDC" },
  { key: "BTC", rail: "bitcoin", asset: "BTC" },
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
  await upsertMerchantAssetBalances(merchantId, balances, timestamp)
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

export function satsToBtcDecimal(value: unknown): string | null {
  const raw = String(value ?? "").trim()
  if (!/^\d+$/.test(raw)) return null
  const sats = BigInt(raw)
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

async function syncSpeedBitcoinBalance(merchantId: string): Promise<SpeedBitcoinSyncState> {
  const profile = await import("@/database/merchantLightningProfiles")
    .then((mod) => mod.getMerchantLightningProfile(merchantId))
    .catch(() => null)
  const accountId = String(profile?.speed_account_id || profile?.speed_connected_account_id || "").trim()
  if (profile?.status !== "ready" || !accountId.startsWith("acct_")) return "not_configured"

  try {
    const response = await getConnectedAccountBalances({ merchantId, speedAccountId: accountId })
    const btc = normalizeSpeedBitcoinBalance(response.available)
    if (btc === null) throw new Error("Speed returned no canonical Bitcoin balance")
    await persistSyncedBalances(merchantId, [{ asset: "BTC", balance: btc }])
    return "live"
  } catch {
    return "failed"
  }
}

export async function syncPineTreeWalletBalances(merchantId: string): Promise<PineTreeWalletSyncResult> {
  const profile = await getPineTreeWalletProfile(merchantId)
  const updates: Array<{ asset: string; balance: number | string }> = []

  if (profile?.solana_address) {
    try {
      const [sol, usdc] = await Promise.all([
        fetchSolanaSolBalance(profile.solana_address),
        fetchSolanaUsdcBalance(profile.solana_address),
      ])
      updates.push({ asset: "SOLANA_SOL", balance: sol })
      updates.push({ asset: "SOLANA_USDC", balance: usdc })
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
      if (eth !== null) updates.push({ asset: "BASE_ETH", balance: eth })
      if (usdc !== null) updates.push({ asset: "BASE_USDC", balance: usdc })
    } catch {
      // Base stays pending if the configured RPC cannot return balances.
    }
  }

  await persistSyncedBalances(merchantId, updates)
  const speedBitcoinSyncState = await syncSpeedBitcoinBalance(merchantId)
  return getPineTreeWalletBalanceSnapshot(merchantId, speedBitcoinSyncState)
}

function isBaseRpcConfigured(): boolean {
  return Boolean(String(process.env.BASE_RPC_URL || "").trim())
}

export async function getPineTreeWalletBalanceSnapshot(
  merchantId: string,
  speedBitcoinSyncState: SpeedBitcoinSyncState = "cached"
): Promise<PineTreeWalletSyncResult> {
  await cancelStaleUnsignedWithdrawalReviews(merchantId).catch(() => ({ canceled: 0 }))
  const [profile, rows, prices, recentWithdrawals, providers, lightningProfile] = await Promise.all([
    getPineTreeWalletProfile(merchantId),
    getWalletBalances(merchantId),
    getMarketPricesUSD(),
    listRecentWalletWithdrawalsForActivity(merchantId, 10).catch(() => []),
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
    if (def.rail === "bitcoin") {
      const updatedAtMs = row?.last_updated ? new Date(row.last_updated).getTime() : Number.NaN
      const stale = !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > BTC_STALE_AFTER_MS
      status = !speedAccountReady
        ? "pending_sync"
        : speedBitcoinSyncState === "live" && row
          ? "synced"
          : row
            ? stale ? "stale" : "cached"
            : "unavailable"
    } else if (row) {
      status = "synced"
    } else if (def.rail === "base" && hasBaseAddress && !baseConfigured) {
      status = "config_missing"
    } else {
      status = "pending_sync"
    }

    return {
      key,
      rail: def.rail,
      asset: def.asset,
      balance,
      usdValue: balance === null
        ? null
        : def.rail === "bitcoin"
          ? String(balance) === "0" ? 0 : null
          : Number(balance) * price,
      lastSyncedAt: row?.last_updated || null,
      status,
    }
  }

  const all = BALANCE_DEFS.map(toBalance)
  const synced = all.filter((item) => item.status === "synced" && item.usdValue !== null)
  const totalUsd = synced.length > 0
    ? synced.reduce((sum, item) => sum + Number(item.usdValue || 0), 0)
    : null

  const recentActivity = recentWithdrawals.map((wd) => {
    // "processing" only ever gets set alongside a tx_hash (the transaction was signed
    // and submitted) - display that as "sent" rather than a raw internal status name,
    // since PineTree has not independently reconciled final on-chain confirmation yet.
    const status =
      wd.status === "confirmed" ? "confirmed"
      : wd.status === "failed" ? "failed"
      : wd.status === "canceled" ? "canceled"
      : wd.status === "blocked" ? "blocked"
      : (wd.status === "processing" || Boolean(wd.tx_hash)) ? "sent"
      : "pending"
    return {
      id: wd.id,
      label: `Sent ${wd.amount_decimal} ${wd.asset}`,
      rail: wd.rail,
      status,
      createdAt: wd.created_at,
    }
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
    totalUsd,
    lastSyncedAt: latestTimestamp(all.map((item) => item.lastSyncedAt)),
    recentActivity,
  }
}
