import {
  getAllMerchantWalletRows,
  getMerchantWalletRows,
  getMerchantAssetBalances,
  upsertMerchantAssetBalances,
  setSystemLastRun,
  getSystemLastRun
} from "@/database"
import { getMarketPricesUSD } from "./marketPrices"

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

export type WalletOverviewResult = {
  wallets: WalletOverviewItem[]
  totalUsd: number
  totalsByAsset: { SOL: number; ETH: number }
  prices: { SOL: number; ETH: number }
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

async function getSolanaBalance(address: string): Promise<number> {
  const rpcUrls = [
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
  const { perWallet, totalsByAsset } = await scanWalletBalances(walletRows)

  await upsertMerchantAssetBalances(
    merchantId,
    [
      { asset: "SOL", balance: totalsByAsset.SOL },
      { asset: "ETH", balance: totalsByAsset.ETH }
    ],
    now
  )

  await setSystemLastRun(now)

  return {
    timestamp: now,
    perWallet,
    totalsByAsset
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
    const { totalsByAsset } = await scanWalletBalances(merchantWallets)

    await upsertMerchantAssetBalances(
      merchantId,
      [
        { asset: "SOL", balance: totalsByAsset.SOL },
        { asset: "ETH", balance: totalsByAsset.ETH }
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

  const walletRows = await getMerchantWalletRows(merchantId)

  const walletBalancesById: Record<string, number> = {}
  let totalsByAsset: Record<"SOL" | "ETH", number> = { SOL: 0, ETH: 0 }
  let timestamp: string | null = null

  if (refresh) {
    const refreshed = await refreshWalletBalancesEngine(merchantId)
    timestamp = refreshed.timestamp

    for (const row of refreshed.perWallet) {
      walletBalancesById[row.id] = row.balance
    }

    totalsByAsset = refreshed.totalsByAsset
  } else {
    const scanned = await scanWalletBalances(walletRows)

    for (const row of scanned.perWallet) {
      walletBalancesById[row.id] = row.balance
    }

    totalsByAsset = scanned.totalsByAsset

    const allZero = scanned.perWallet.length > 0 && scanned.perWallet.every((w) => w.balance === 0)
    if (allZero) {
      const balances = await getMerchantAssetBalances(merchantId)
      const fallbackTotals: Record<"SOL" | "ETH", number> = { SOL: 0, ETH: 0 }

      for (const b of balances) {
        const asset = String(b.asset || "").toUpperCase().trim()
        const value = Number(b.balance ?? 0) || 0

        if (asset === "SOL" || asset === "SOLANA") fallbackTotals.SOL += value
        if (asset === "ETH" || asset === "ETHEREUM" || asset === "BASE") fallbackTotals.ETH += value
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

  const totalUsd = wallets.reduce((sum, w) => sum + w.usdValue, 0)

  if (wallets.length > 0) {
    totalsByAsset = wallets.reduce(
      (acc, wallet) => {
        if (wallet.assetSymbol === "SOL") acc.SOL += wallet.nativeBalance
        if (wallet.assetSymbol === "ETH") acc.ETH += wallet.nativeBalance
        return acc
      },
      { SOL: 0, ETH: 0 }
    )
  }

  return {
    wallets,
    totalUsd,
    totalsByAsset,
    prices,
    lastRun: timestamp
  }
}
