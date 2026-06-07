/**
 * Report display normalization helpers.
 *
 * These functions normalize raw database values into report-safe display
 * values. They never mutate or infer a different payment lifecycle status.
 */

/**
 * Returns the persisted lifecycle status in a consistent display shape.
 */
export function normalizeReportStatus(rawStatus: string, createdAt: string): string {
  void createdAt
  return String(rawStatus || "UNKNOWN").trim().toUpperCase()
}

/**
 * Returns the display network label for a payment.
 * Cash payments have no blockchain network; they are explicitly labelled
 * "Cash" using the provider field.
 */
type AssetRow = { network: string; asset: string; gross: number; status: string }

export function normalizeReportProvider(rawProvider: string | null | undefined): string {
  const provider = String(rawProvider || "").toLowerCase().trim()

  if (
    provider === "lightning_speed" ||
    provider === "speed" ||
    provider === "tryspeed" ||
    provider === "try_speed" ||
    provider === "speed_lightning"
  ) return "Speed"

  if (
    provider === "lightning_nwc" ||
    provider === "nwc" ||
    provider === "nwc_lightning"
  ) return "NWC"

  if (
    provider === "lightning" ||
    provider === "bitcoin_lightning" ||
    provider === "bitcoin lightning" ||
    provider === "btc_lightning" ||
    provider === "lightning_btc"
  ) return "Lightning"

  if (provider === "solana") return "Solana Pay"
  if (provider === "base") return "Base Pay"
  if (provider === "coinbase") return "Coinbase Business"
  if (provider === "shift4") return "Shift4"
  if (provider === "cash") return "Cash"

  return String(rawProvider || "Unknown")
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

  const currency = String(rawCurrency || "").trim().toUpperCase()
  return currency || asset || "USD"
}

export function buildNetworkAssetLabel(network: string, asset: string): string {
  if (network === "Lightning" && asset === "BTC") return "Lightning BTC"
  if (!asset || asset === "USD") return network
  if (!network || network === "Unknown") return asset
  return `${network} ${asset}`
}

export function buildNetworkAssetTotals(rows: AssetRow[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    if (row.status !== "CONFIRMED") continue
    const label = buildNetworkAssetLabel(row.network, row.asset)
    totals[label] = (totals[label] || 0) + row.gross
  }
  return totals
}

export function normalizeReportNetwork(
  rawNetwork: string | null | undefined,
  rawProvider: string | null | undefined
): string {
  const provider = String(rawProvider || "").toLowerCase().trim()
  if (provider === "cash") return "Cash"

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
  ) return "Lightning"
  if (network === "solana") return "Solana"
  if (network === "base") return "Base"
  if (network === "ethereum") return "Ethereum"
  if (network === "cash") return "Cash"
  if (!network) return "Unknown"

  return String(rawNetwork)
}
