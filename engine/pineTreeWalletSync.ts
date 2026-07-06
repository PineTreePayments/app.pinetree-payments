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
import { buildPineTreeRailReadiness } from "@/lib/pinetreeRailReadiness"

export type PineTreeBalanceAsset = {
  key: "BASE_ETH" | "BASE_USDC" | "SOLANA_SOL" | "SOLANA_USDC" | "BTC"
  rail: "base" | "solana" | "bitcoin"
  asset: "ETH" | "USDC" | "SOL" | "BTC"
  balance: number | null
  usdValue: number | null
  lastSyncedAt: string | null
  status: "synced" | "pending_sync" | "config_missing"
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
  balances: Array<{ asset: string; balance: number }>
) {
  if (balances.length === 0) return null
  const timestamp = new Date().toISOString()
  await upsertMerchantAssetBalances(merchantId, balances, timestamp)
  return timestamp
}

export async function syncPineTreeWalletBalances(merchantId: string): Promise<PineTreeWalletSyncResult> {
  const profile = await getPineTreeWalletProfile(merchantId)
  const updates: Array<{ asset: string; balance: number }> = []

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
  return getPineTreeWalletBalanceSnapshot(merchantId)
}

function isBaseRpcConfigured(): boolean {
  return Boolean(String(process.env.BASE_RPC_URL || "").trim())
}

export async function getPineTreeWalletBalanceSnapshot(
  merchantId: string
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
  const speedAccountReady = Boolean(
    lightningProfile?.status === "ready" ||
    (
      String(speedCredentials.speed_account_id || speedCredentials.account_id || "").trim() &&
      (String(speedCredentials.setup_status || "").trim() === "ready" ||
        String(speedCredentials.setup_status || "").trim() === "ready_for_payments")
    )
  )
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
    const balance = row ? Number(row.balance ?? 0) : null
    const price = def.asset === "USDC" ? 1 : def.asset === "SOL" ? prices.SOL : def.asset === "ETH" ? prices.ETH : prices.BTC

    let status: PineTreeBalanceAsset["status"]
    if (row) {
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
      usdValue: balance === null ? null : balance * price,
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

  return {
    readiness: {
      base: railReadiness.base.walletProvisioned,
      solana: railReadiness.solana.walletProvisioned,
      bitcoin: railReadiness.bitcoin_lightning.walletProvisioned,
    },
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
