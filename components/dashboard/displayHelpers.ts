import { cashTransactionSecondaryLabel } from "@/lib/transactionRailDisplay"

export function formatDashboardProvider(provider: string | null | undefined) {
  const normalized = String(provider || "").trim().toLowerCase()

  const labels: Record<string, string> = {
    coinbase: "Coinbase Business",
    solana: "Solana Pay",
    shift4: "Shift4",
    base: "Base Pay",
    lightning: "Lightning",
    lightning_speed: "Speed",
    tryspeed: "Speed",
    try_speed: "Speed",
    speed_lightning: "Speed",
    lightning_nwc: "NWC",
    nwc_lightning: "NWC",
    cash: "Cash",
    speed: "Speed",
    nwc: "NWC",
    phantom: "Phantom",
    solflare: "Solflare",
    metamask: "MetaMask",
    trust: "Trust Wallet",
    coinbase_wallet: "Coinbase Wallet",
    baseapp: "Base Wallet"
  }

  if (labels[normalized]) return labels[normalized]
  if (!normalized) return "-"

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatDashboardNetwork(network: string | null | undefined) {
  const normalized = String(network || "").trim().toLowerCase()

  const labels: Record<string, string> = {
    cash: "Cash",
    usd: "USD",
    solana: "Solana",
    base: "Base",
    ethereum: "Ethereum",
    bitcoin_lightning: "Lightning",
    btc_lightning: "Lightning",
    lightning_btc: "Lightning",
    lightning: "Lightning",
    "bitcoin lightning": "Lightning"
  }

  if (labels[normalized]) return labels[normalized]
  if (!normalized) return "-"

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatTransactionSecondaryLabel(
  provider: string | null | undefined,
  network: string | null | undefined
) {
  return cashTransactionSecondaryLabel(provider) || formatDashboardNetwork(network)
}

export function mostFrequentKey(counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || ""
}

export function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = String(getKey(item) || "").trim()
    if (!key || key === "unknown") return acc
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

export function buildNeutralInsight(hasData: boolean, fallback: string) {
  return hasData ? "" : fallback
}
