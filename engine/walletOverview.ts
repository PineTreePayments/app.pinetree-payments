import {
  getAllMerchantWalletRows,
  getMerchantWalletRows,
  getMerchantAssetBalances,
  upsertMerchantAssetBalances,
  setSystemLastRun,
  getSystemLastRun,
  supabaseAdmin,
  supabase
} from "@/database"
import { getMarketPricesUSD } from "./marketPrices"
import { getSpeedAccountBalanceBtc, maskSpeedAccountId } from "@/providers/lightning/getBalance"

const db = supabaseAdmin || supabase

type WalletNetwork = "solana" | "base" | "ethereum"

type WalletBalanceSnapshot = {
  id: string
  network: WalletNetwork
  balance: number
}

export type WalletOverviewItem = {
  id: string
  network: string
  provider: string | null
  wallet_address: string
  assetSymbol: "SOL" | "ETH"
  nativeBalance: number
  usdValue: number
}

export type WalletOverviewPaymentRail = {
  id: string
  type: "bitcoin_lightning"
  provider: "Speed"
  status: "Connected"
  speedAccountId: string
  assetSymbol: "BTC"
  nativeBalance: number
  usdValue: number
}

export type WalletOverviewResult = {
  wallets: WalletOverviewItem[]
  paymentRails: WalletOverviewPaymentRail[]
  totalUsd: number
  totalsByAsset: { SOL: number; ETH: number; BTC: number }
  prices: { SOL: number; ETH: number; BTC: number }
  lastRun: string | null
}

function normalizeNetwork(network: string): WalletNetwork | null {
  const n = String(network || "").toLowerCase().trim()
  if (n === "solana") return "solana"
  if (n === "base") return "base"
  if (n === "ethereum") return "ethereum"
  return null
}

function networkAsset(network: WalletNetwork): "SOL" | "ETH" {
  return network === "solana" ? "SOL" : "ETH"
}

async function getLightningPaymentRails(
  merchantId: string,
  prices: { BTC: number }
): Promise<WalletOverviewPaymentRail[]> {
  const { data, error } = await db
    .from("merchant_providers")
    .select(`
      id,
      provider,
      status,
      speed_account_id:credentials->>speed_account_id
    `)
    .eq("merchant_id", merchantId)
    .eq("provider", "lightning")
    .in("status", ["connected", "active"])

  if (error || !data) return []

  const rails = (data as Array<{
    id?: string | null
    speed_account_id?: string | null
  }>)
    .map((row) => {
      const speedAccountId = String(row.speed_account_id || "").trim()

      if (!row.id || !speedAccountId) {
        return null
      }

      return {
        id: row.id,
        type: "bitcoin_lightning",
        provider: "Speed",
        status: "Connected",
        speedAccountId,
        assetSymbol: "BTC",
        nativeBalance: 0,
        usdValue: 0
      } satisfies WalletOverviewPaymentRail
    })
    .filter(Boolean) as WalletOverviewPaymentRail[]

  const hydratedRails = await Promise.all(
    rails.map(async (rail) => {
      const nativeBalance = await getSpeedAccountBalanceBtc(rail.speedAccountId)
      return {
        ...rail,
        nativeBalance,
        usdValue: nativeBalance * prices.BTC
      }
    })
  )

  console.info("[lightning/walletOverview] final Lightning rail balances", {
    merchantId,
    rails: hydratedRails.map((rail) => ({
      id: rail.id,
      type: rail.type,
      provider: rail.provider,
      speedAccountIdMasked: maskSpeedAccountId(rail.speedAccountId),
      assetSymbol: rail.assetSymbol,
      nativeBalance: rail.nativeBalance,
      usdValue: rail.usdValue
    }))
  })

  return hydratedRails
}

async function getSolanaBalance(address: string): Promise<number> {
  const rpcUrls = [
    process.env.RPC_URL_SOLANA,
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com"
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
          params: [address]
        }),
        cache: "no-store"
      })

      const data = await res.json()
      if (data?.error) continue

      return Number(data?.result?.value ?? 0) / 1_000_000_000
    } catch {
      // try next
    }
  }

  return 0
}

async function getEvmBalance(address: string, network: "base" | "ethereum"): Promise<number> {
  const rpcUrls = network === "base"
    ? [process.env.BASE_RPC_URL, "https://mainnet.base.org", "https://base.llamarpc.com"]
    : [process.env.ETH_RPC_URL, "https://eth.llamarpc.com", "https://ethereum.publicnode.com"]

  for (const url of rpcUrls.filter(Boolean) as string[]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBalance",
          params: [address, "latest"]
        }),
        cache: "no-store"
      })

      const data = await res.json()
      if (data?.error) continue

      const hex = String(data?.result ?? "0x0")
      return Number(BigInt(hex)) / 1e18
    } catch {
      // try next
    }
  }

  return 0
}

async function scanWalletBalances(
  walletRows: Array<{ id: string; network: string; wallet_address: string }>
): Promise<{
  perWallet: WalletBalanceSnapshot[]
  totalsByAsset: Record<"SOL" | "ETH", number>
}> {
  const perWallet: WalletBalanceSnapshot[] = []
  const totalsByAsset: Record<"SOL" | "ETH", number> = { SOL: 0, ETH: 0 }

  for (const w of walletRows) {
    const network = normalizeNetwork(w.network)
    const address = String(w.wallet_address || "")

    if (!network || !address) continue

    let balance = 0

    if (network === "solana") {
      balance = await getSolanaBalance(address)
    } else {
      balance = await getEvmBalance(address, network)
    }

    perWallet.push({ id: w.id, network, balance })
    const asset = networkAsset(network)
    totalsByAsset[asset] += balance
  }

  return { perWallet, totalsByAsset }
}

export async function refreshWalletBalancesEngine(merchantId: string) {
  const walletRows = await getMerchantWalletRows(merchantId)
  const now = new Date().toISOString()
  const prices = await getMarketPricesUSD()
  const [{ perWallet, totalsByAsset }, paymentRails] = await Promise.all([
    scanWalletBalances(walletRows),
    getLightningPaymentRails(merchantId, prices)
  ])

  const btcBalance = paymentRails.reduce((sum, rail) => sum + rail.nativeBalance, 0)

  await upsertMerchantAssetBalances(
    merchantId,
    [
      { asset: "SOL", balance: totalsByAsset.SOL },
      { asset: "ETH", balance: totalsByAsset.ETH },
      { asset: "BTC", balance: btcBalance }
    ],
    now
  )

  await setSystemLastRun(now)

  return {
    timestamp: now,
    perWallet,
    paymentRails,
    totalsByAsset: {
      ...totalsByAsset,
      BTC: btcBalance
    }
  }
}

export async function refreshAllWalletBalancesEngine() {
  const walletRows = await getAllMerchantWalletRows()
  const now = new Date().toISOString()

  const walletsByMerchant = new Map<string, Array<{ id: string; network: string; wallet_address: string }>>()

  for (const wallet of walletRows) {
    const merchantId = String(wallet.merchant_id || "").trim()
    if (!merchantId) continue

    const existing = walletsByMerchant.get(merchantId) || []
    existing.push({
      id: wallet.id,
      network: wallet.network,
      wallet_address: wallet.wallet_address
    })
    walletsByMerchant.set(merchantId, existing)
  }

  for (const [merchantId, merchantWallets] of walletsByMerchant.entries()) {
    const prices = await getMarketPricesUSD()
    const [{ totalsByAsset }, paymentRails] = await Promise.all([
      scanWalletBalances(merchantWallets),
      getLightningPaymentRails(merchantId, prices)
    ])
    const btcBalance = paymentRails.reduce((sum, rail) => sum + rail.nativeBalance, 0)

    await upsertMerchantAssetBalances(
      merchantId,
      [
        { asset: "SOL", balance: totalsByAsset.SOL },
        { asset: "ETH", balance: totalsByAsset.ETH },
        { asset: "BTC", balance: btcBalance }
      ],
      now
    )
  }

  await setSystemLastRun(now)

  return {
    success: true,
    timestamp: now,
    merchantCount: walletsByMerchant.size,
    walletCount: walletRows.length
  }
}

export async function getWalletOverviewEngine(
  merchantId: string,
  options?: { refresh?: boolean }
): Promise<WalletOverviewResult> {
  const refresh = options?.refresh === true
  const prices = await getMarketPricesUSD()

  const [walletRows, paymentRails] = await Promise.all([
    getMerchantWalletRows(merchantId),
    getLightningPaymentRails(merchantId, prices)
  ])
  let activePaymentRails = paymentRails

  const walletBalancesById: Record<string, number> = {}
  let totalsByAsset: Record<"SOL" | "ETH" | "BTC", number> = { SOL: 0, ETH: 0, BTC: 0 }
  let timestamp: string | null = null

  if (refresh) {
    const refreshed = await refreshWalletBalancesEngine(merchantId)
    timestamp = refreshed.timestamp

    for (const row of refreshed.perWallet) {
      walletBalancesById[row.id] = row.balance
    }

    totalsByAsset = refreshed.totalsByAsset
    activePaymentRails = refreshed.paymentRails
  } else {
    const scanned = await scanWalletBalances(walletRows)

    for (const row of scanned.perWallet) {
      walletBalancesById[row.id] = row.balance
    }

    totalsByAsset = { ...scanned.totalsByAsset, BTC: 0 }

    const allZero = scanned.perWallet.length > 0 && scanned.perWallet.every((w) => w.balance === 0)
    if (allZero) {
      const balances = await getMerchantAssetBalances(merchantId)
      const fallbackTotals: Record<"SOL" | "ETH" | "BTC", number> = { SOL: 0, ETH: 0, BTC: 0 }

      for (const b of balances) {
        const asset = String(b.asset || "").toUpperCase().trim()
        const value = Number(b.balance ?? 0) || 0

        if (asset === "SOL" || asset === "SOLANA") fallbackTotals.SOL += value
        if (asset === "ETH" || asset === "ETHEREUM" || asset === "BASE") fallbackTotals.ETH += value
        if (asset === "BTC" || asset === "BITCOIN" || asset === "BITCOIN_LIGHTNING") fallbackTotals.BTC += value
      }

      totalsByAsset = fallbackTotals
    }

    timestamp = await getSystemLastRun()
  }

  const wallets: WalletOverviewItem[] = walletRows
    .map((w) => {
      const network = normalizeNetwork(w.network)
      if (!network) return null

      const assetSymbol = networkAsset(network)
      const nativeBalance = walletBalancesById[w.id] ?? 0
      const usdValue = nativeBalance * (assetSymbol === "SOL" ? prices.SOL : prices.ETH)

      return {
        id: w.id,
        network: w.network,
        provider: w.provider || w.wallet_type || null,
        wallet_address: w.wallet_address,
        assetSymbol,
        nativeBalance,
        usdValue
      }
    })
    .filter(Boolean) as WalletOverviewItem[]

  const totalUsd =
    wallets.reduce((sum, w) => sum + w.usdValue, 0) +
    activePaymentRails.reduce((sum, rail) => sum + rail.usdValue, 0)

  if (wallets.length > 0) {
    const walletTotals = wallets.reduce(
      (acc, wallet) => {
        if (wallet.assetSymbol === "SOL") acc.SOL += wallet.nativeBalance
        if (wallet.assetSymbol === "ETH") acc.ETH += wallet.nativeBalance
        return acc
      },
      { SOL: 0, ETH: 0 }
    )
    totalsByAsset.SOL = walletTotals.SOL
    totalsByAsset.ETH = walletTotals.ETH
  }

  totalsByAsset.BTC = activePaymentRails.reduce((sum, rail) => sum + rail.nativeBalance, 0)

  return {
    wallets,
    paymentRails: activePaymentRails,
    totalUsd,
    totalsByAsset,
    prices,
    lastRun: timestamp
  }
}
