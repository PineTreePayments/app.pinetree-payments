import {
  cashTransactionSecondaryLabel,
  formatTransactionProviderLabel
} from "@/lib/transactionRailDisplay"
import { getPaymentStatusLabel } from "@/lib/utils/paymentStatus"

/**
 * Report display normalization helpers.
 *
 * SOURCE-OF-TRUTH RULE:
 * These functions format raw database values for display only.
 * They must never infer or substitute a different payment lifecycle status.
 * Age, timeout, and page context are not valid inputs for status decisions.
 * Only PineTree Engine and sweep logic may change payment state.
 */

/**
 * Returns the persisted lifecycle status uppercased for display.
 *
 * The `createdAt` parameter is accepted for backward compatibility but is
 * intentionally ignored — age-based relabeling (e.g. PENDING → INCOMPLETE)
 * is forbidden here. If a status must change, the sweep/engine must have
 * already written the new value to the database before this is called.
 */
export function normalizeReportStatus(rawStatus: string, createdAt: string): string {
  void createdAt
  return getPaymentStatusLabel(rawStatus)
}

/**
 * Returns the display network label for a payment.
 * Cash payments have no blockchain network; their secondary rail label is
 * the settlement currency shown alongside the Cash provider label.
 */
type AssetRow = { network: string; asset: string; gross: number; status: string }

export function normalizeReportProvider(rawProvider: string | null | undefined): string {
  return formatTransactionProviderLabel(rawProvider)
}

export function normalizeReportAsset(
  rawAsset: string | null | undefined,
  rawNetwork?: string | null,
  rawProvider?: string | null,
  rawCurrency?: string | null
): string {
  const asset = String(rawAsset || "").trim().toUpperCase()
  const network = String(rawNetwork || "").toLowerCase().trim()
  const provider = String(rawProvider || "").toLowerCase().trim()

  if (
    network === "bitcoin_lightning" ||
    network === "bitcoin lightning" ||
    network === "lightning" ||
    network === "btc_lightning" ||
    network === "lightning_btc" ||
    provider === "lightning_speed" ||
    provider === "speed" ||
    provider === "tryspeed" ||
    provider === "lightning_nwc" ||
    provider === "nwc" ||
    provider === "lightning"
  ) return "BTC"

  if (asset === "SOL" || asset === "USDC" || asset === "ETH" || asset === "BTC" || asset === "USD") {
    return asset
  }

  if (network === "solana" || network === "base") return "Unknown asset"

  const currency = String(rawCurrency || "").trim().toUpperCase()
  return currency || asset || "USD"
}

export function buildNetworkAssetLabel(network: string, asset: string): string {
  if (network === "Bitcoin Lightning" && asset === "BTC") return "Bitcoin Lightning BTC"
  if (!asset || asset === "USD") return network
  if (!network || network === "Unknown") return asset
  return `${network} ${asset}`
}

export function buildNetworkAssetTotals(rows: AssetRow[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    if (row.status !== "Confirmed" && row.status !== "CONFIRMED") continue
    const label = buildNetworkAssetLabel(row.network, row.asset)
    totals[label] = (totals[label] || 0) + row.gross
  }
  return totals
}

export function normalizeReportNetwork(
  rawNetwork: string | null | undefined,
  rawProvider: string | null | undefined
): string {
  const cashLabel = cashTransactionSecondaryLabel(rawProvider)
  if (cashLabel) return cashLabel

  const provider = String(rawProvider || "").toLowerCase().trim()

  const network = String(rawNetwork || "").toLowerCase().trim()
  if (
    network === "bitcoin_lightning" ||
    network === "bitcoin lightning" ||
    network === "lightning" ||
    network === "btc_lightning" ||
    network === "lightning_btc" ||
    provider === "lightning_speed" ||
    provider === "speed" ||
    provider === "tryspeed" ||
    provider === "lightning_nwc" ||
    provider === "nwc" ||
    provider === "lightning"
  ) return "Bitcoin Lightning"
  if (network === "solana") return "Solana"
  if (network === "base") return "Base"
  if (network === "ethereum") return "Ethereum"
  if (network === "cash") return "Cash"
  if (!network) return "Unknown"

  return String(rawNetwork)
}
