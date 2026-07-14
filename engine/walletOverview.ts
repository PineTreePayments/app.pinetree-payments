import {
  getAllMerchantWalletRows,
  getMerchantWalletRows,
  getMerchantAssetBalances,
  upsertMerchantAssetBalances,
  setSystemLastRun,
  getSystemLastRun,
} from "@/database"
import { getMarketPricesUSD } from "./marketPrices"
import {
  getMerchantNwcStatus,
  getMerchantSpeedProvider,
  type MerchantNwcStatus
} from "@/database/merchantProviders"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled
} from "@/providers/lightning/speedClient"
import {
  listRecentWalletOperationsForMerchant,
  type WalletOperationRecord
} from "@/database/walletOperations"
import {
  listSettlementWithdrawalsForMerchant,
  type SettlementWithdrawalRecord
} from "@/database/settlementWithdrawals"
import {
  listLightningPayoutJobsForMerchant,
  type LightningPayoutJob
} from "@/database/lightningPayoutJobs"
import {
  listRecentWalletWithdrawalsForActivity,
  type WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"

// ─── NWC Types ────────────────────────────────────────────────────────────────

export type NwcConnectionStatus = {
  connected: boolean
  ready: boolean
  missingPermissions: string[]
  readinessReason: string | null
  walletLabel: string | null
  canMakeInvoice: boolean
  canLookupInvoice: boolean
  canPayInvoice: boolean
  canCollectFee: boolean
  lastTestedAt: string | null
  connectionError: string | null
}

// ─── Wallet Network Types ─────────────────────────────────────────────────────

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
  wallet_type: string | null
  wallet_address: string
  assetSymbol: "SOL" | "ETH"
  nativeBalance: number
  usdValue: number
}

export type WalletOverviewPaymentRail = {
  id: string
  type: "bitcoin_lightning"
  provider: "PineTree" | "Speed" | "NWC"
  wallet_type: "pinetree" | "speed" | "nwc"
  status: "Connected" | "Not Connected" | "Error"
  walletLabel: string
  wallet_address: string
  assetSymbol: "BTC"
  nativeBalance: number
  usdValue: number
  nwcConnectionStatus: NwcConnectionStatus | null
}

export type WalletOverviewOperation = {
  id: string
  provider: string
  operationType: string
  asset: string
  network: string
  amount: number
  destinationType: string
  destinationValue: string | null
  providerReference: string | null
  status: string
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string | null
}

export type WalletOverviewResult = {
  wallets: WalletOverviewItem[]
  paymentRails: WalletOverviewPaymentRail[]
  recentOperations: WalletOverviewOperation[]
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

function buildNwcConnectionStatus(
  nwcStatus: MerchantNwcStatus | null
): NwcConnectionStatus {
  if (!nwcStatus) {
    return {
      connected: false,
      ready: false,
      missingPermissions: ["make_invoice", "lookup_invoice", "pay_invoice"],
      readinessReason: "Bitcoin Lightning is managed through PineTree Wallet.",
      walletLabel: null,
      canMakeInvoice: false,
      canLookupInvoice: false,
      canPayInvoice: false,
      canCollectFee: false,
      lastTestedAt: null,
      connectionError: null
    }
  }
  const caps = nwcStatus.capabilities
  return {
    connected: true,
    ready: nwcStatus.readiness.ready,
    missingPermissions: nwcStatus.readiness.missingPermissions,
    readinessReason: nwcStatus.readiness.reason,
    walletLabel: nwcStatus.walletLabel,
    canMakeInvoice: Boolean(caps?.canMakeInvoice),
    canLookupInvoice: Boolean(caps?.canLookupInvoice),
    canPayInvoice: Boolean(caps?.canPayInvoice),
    canCollectFee: nwcStatus.readiness.ready,
    lastTestedAt: nwcStatus.lastTestedAt,
    connectionError: null
  }
}

function summarizeWalletOperation(row: WalletOperationRecord): WalletOverviewOperation {
  return {
    id: row.id,
    provider: String(row.provider || "unknown"),
    operationType: row.operation_type,
    asset: row.asset,
    network: row.network,
    amount: Number(row.amount),
    destinationType: row.destination_type,
    destinationValue: row.destination_value,
    providerReference: row.provider_operation_id,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function summarizeSettlementWithdrawal(row: SettlementWithdrawalRecord): WalletOverviewOperation {
  return {
    id: row.id,
    provider: "settlement",
    operationType: row.movement_type === "direct_send" ? "SEND_CRYPTO" : "CASH_OUT",
    asset: row.asset,
    network: row.network,
    amount: Number(row.amount),
    destinationType: row.destination_kind || "saved_destination",
    destinationValue: row.destination_address,
    providerReference: row.tx_hash,
    status: row.status,
    errorCode: row.status === "FAILED" ? "WITHDRAWAL_FAILED" : null,
    errorMessage: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function summarizeLightningPayoutJob(row: LightningPayoutJob): WalletOverviewOperation {
  return {
    id: row.id,
    provider: row.provider,
    operationType: "LIGHTNING_SETTLEMENT",
    asset: "BTC",
    network: "bitcoin",
    amount: Number(row.merchant_net_sats || 0) / 100_000_000,
    destinationType: "pinetree_btc_wallet",
    destinationValue: row.btc_payout_address || null,
    providerReference: row.txid || row.speed_payout_id || row.speed_withdraw_request_id,
    status: row.status === "pending" || row.status === "processing"
      ? "SETTLEMENT_PENDING"
      : row.status === "completed"
        ? "SETTLEMENT_COMPLETED"
        : row.status === "failed"
          ? "NEEDS_ATTENTION"
          : row.status.toUpperCase(),
    errorCode: row.status === "failed" ? "LIGHTNING_PAYOUT_FAILED" : null,
    errorMessage: row.status === "failed" ? row.last_error : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function summarizeWalletWithdrawalRequest(row: WalletWithdrawalRequestRecord): WalletOverviewOperation {
  return {
    id: row.id,
    provider: row.provider || "pinetree",
    operationType: "PINETREE_WITHDRAWAL",
    asset: row.asset,
    network: row.rail,
    amount: Number(row.amount_decimal) || 0,
    destinationType: "crypto_address",
    destinationValue: row.destination_address,
    providerReference: row.tx_hash,
    status: row.status.toUpperCase(),
    errorCode: row.status === "failed" ? "WITHDRAWAL_FAILED" : null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function listRecentWalletActivity(merchantId: string): Promise<WalletOverviewOperation[]> {
  const [walletOperations, settlementWithdrawals, lightningPayoutJobs, walletWithdrawals] = await Promise.all([
    listRecentWalletOperationsForMerchant(merchantId, { limit: 25 }),
    listSettlementWithdrawalsForMerchant(merchantId, { limit: 25 }),
    listLightningPayoutJobsForMerchant(merchantId, { limit: 25 }).catch(() => []),
    listRecentWalletWithdrawalsForActivity(merchantId, 25).catch(() => [] as WalletWithdrawalRequestRecord[]),
  ])

  const operationRows = walletOperations
    .filter((row) => {
      const type = String(row.operation_type || "").toUpperCase()
      return type === "SEND_CRYPTO" || type === "CASH_OUT" || type === "PROVIDER_ACTION"
    })
    .map(summarizeWalletOperation)

  return [
    ...operationRows,
    ...settlementWithdrawals.map(summarizeSettlementWithdrawal),
    ...lightningPayoutJobs.map(summarizeLightningPayoutJob),
    ...walletWithdrawals.map(summarizeWalletWithdrawalRequest),
  ]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 8)
}

async function getLightningPaymentRails(
  merchantId: string,
  prices: { BTC: number }
): Promise<WalletOverviewPaymentRail[]> {
  if (isSpeedPlatformTreasurySweepEnabled()) {
    const [profile, speedConfig] = await Promise.all([
      getPineTreeWalletProfile(merchantId),
      Promise.resolve(getPineTreeSpeedConfigStatus())
    ])
    const btcAddress = String(profile?.btc_address || "").trim()
    const ready = Boolean(speedConfig.configured)

    return [{
      id: profile?.id || "pinetree-bitcoin-lightning",
      type: "bitcoin_lightning",
      provider: "PineTree",
      wallet_type: "pinetree",
      status: ready ? "Connected" : speedConfig.configured ? "Not Connected" : "Error",
      walletLabel: "Bitcoin Lightning",
      wallet_address: btcAddress || "PineTree managed",
      assetSymbol: "BTC",
      nativeBalance: 0,
      usdValue: 0,
      nwcConnectionStatus: null
    }]
  }

  const [speedStatus, nwcStatus] = await Promise.all([
    getMerchantSpeedProvider(merchantId),
    getMerchantNwcStatus(merchantId)
  ])
  const speedAccountId = String(speedStatus?.accountId || "").trim()
  const speedProviderStatus = String(speedStatus?.accountStatus || "").trim().toLowerCase()
  const speedConnected = Boolean(speedAccountId && speedProviderStatus === "active")

  console.info("[lightning/walletOverview] Lightning rails loaded", {
    merchantId,
    speedConnected,
    nwcConnected: Boolean(nwcStatus)
  })

  if (speedConnected) {
    return [{
      id: speedStatus?.providerRowId || "lightning-speed",
      type: "bitcoin_lightning",
      provider: "Speed",
      wallet_type: "speed",
      status: "Connected",
      walletLabel: "Bitcoin Lightning",
      wallet_address: speedAccountId,
      assetSymbol: "BTC",
      nativeBalance: 0,
      usdValue: 0,
      nwcConnectionStatus: null
    }]
  }

  if (nwcStatus) {
    return [{
      id: nwcStatus.providerRowId,
      type: "bitcoin_lightning",
      provider: "NWC",
      wallet_type: "nwc",
      status: "Connected",
      walletLabel: "Bitcoin Lightning",
      wallet_address: nwcStatus.walletLabel,
      assetSymbol: "BTC",
      nativeBalance: 0,
      usdValue: 0,
      nwcConnectionStatus: buildNwcConnectionStatus(nwcStatus)
    }]
  }

  return []
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
  const recentOperations = await listRecentWalletActivity(merchantId)
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
        wallet_type: w.wallet_type || null,
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
    recentOperations,
    totalUsd,
    totalsByAsset,
    prices,
    lastRun: timestamp
  }
}
