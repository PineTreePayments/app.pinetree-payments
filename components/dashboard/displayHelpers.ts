import { cashTransactionSecondaryLabel } from "@/lib/transactionRailDisplay"
import { normalizeTransactionAsset, type TransactionDisplayMetadata } from "@/lib/transactionDisplay"

/**
 * Comparison key for a stored identifier: case- and separator-insensitive, so
 * `lightning_speed`, `LIGHTNING-SPEED` and `Lightning Speed` are one lookup.
 * Presentation only — the stored value is never rewritten.
 */
function displayKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Readable fallback for an identifier PineTree has no polished name for. */
export function titleCaseIdentifier(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * The one provider naming table in the repo. Keys are comparison keys, so a
 * stored `base_pay`, `basePay` or `BASE PAY` all resolve to "Base Pay".
 *
 * Providers are commercial products ("Base Pay", "Solana Pay"); rails and
 * networks are settlement concepts ("Base", "Solana"). The two vocabularies
 * are deliberately kept apart — see `formatRailName` in
 * components/admin/displayFormatters.ts.
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  coinbase: "Coinbase Business",
  coinbasewallet: "Coinbase Wallet",
  solana: "Solana Pay",
  solanapay: "Solana Pay",
  shift4: "Shift4",
  fluidpay: "FluidPay",
  fluid: "FluidPay",
  base: "Base Pay",
  basepay: "Base Pay",
  stripe: "Stripe",
  lightning: "Bitcoin Lightning",
  lightningspeed: "Bitcoin Lightning",
  speedlightning: "Bitcoin Lightning",
  bitcoinlightning: "Bitcoin Lightning",
  btclightning: "Bitcoin Lightning",
  lightningbtc: "Bitcoin Lightning",
  tryspeed: "Bitcoin Lightning",
  speed: "Bitcoin Lightning",
  lightningnwc: "Bitcoin Lightning",
  nwclightning: "Bitcoin Lightning",
  nwc: "Bitcoin Lightning",
  cash: "Cash",
  phantom: "Phantom",
  solflare: "Solflare",
  metamask: "MetaMask",
  trust: "Trust Wallet",
  baseapp: "Base Wallet"
}

export function formatDashboardProvider(provider: string | null | undefined) {
  const key = displayKey(provider)
  if (PROVIDER_DISPLAY_NAMES[key]) return PROVIDER_DISPLAY_NAMES[key]
  if (!key) return "-"
  return titleCaseIdentifier(String(provider))
}

/**
 * The one network naming table in the repo. Networks are settlement networks,
 * so `solana` is "Solana" here and never "Solana Pay".
 */
const NETWORK_DISPLAY_NAMES: Record<string, string> = {
  cash: "Cash",
  usd: "USD",
  solana: "Solana",
  base: "Base",
  ethereum: "Ethereum",
  bitcoinlightning: "Bitcoin Lightning",
  btclightning: "Bitcoin Lightning",
  lightningbtc: "Bitcoin Lightning",
  lightning: "Bitcoin Lightning"
}

export function formatDashboardNetwork(network: string | null | undefined) {
  const key = displayKey(network)
  if (NETWORK_DISPLAY_NAMES[key]) return NETWORK_DISPLAY_NAMES[key]
  if (!key) return "-"
  return titleCaseIdentifier(String(network))
}

export function formatTransactionSecondaryLabel(
  provider: string | null | undefined,
  network: string | null | undefined,
  payment?: {
    currency?: string | null
    metadata?: TransactionDisplayMetadata
  } | null
) {
  return cashTransactionSecondaryLabel(provider) || normalizeTransactionAsset({
    provider,
    network,
    currency: payment?.currency,
    metadata: payment?.metadata
  })
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
