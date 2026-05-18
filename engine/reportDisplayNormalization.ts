/**
 * Report display normalization helpers.
 *
 * These functions normalise raw database values into report-safe display values.
 * They never mutate the database; all changes are representation-only.
 *
 * Status threshold rationale:
 *   PENDING  > 5 min  → INCOMPLETE  (matches dashboard paymentStatus.ts stale threshold)
 *   CREATED  > 30 min → INCOMPLETE  (conservative: CREATED that never progressed)
 */

const PENDING_STALE_MINUTES = 5
const CREATED_STALE_MINUTES = 30

/**
 * Returns the display status to use in reports.
 * Stale PENDING and CREATED payments are shown as INCOMPLETE for accounting clarity.
 * No database value is mutated.
 */
export function normalizeReportStatus(rawStatus: string, createdAt: string): string {
  const status = String(rawStatus || "UNKNOWN").toUpperCase()

  if (status === "PENDING" || status === "CREATED") {
    const ageMinutes = (Date.now() - new Date(createdAt).getTime()) / 60000
    const threshold = status === "PENDING" ? PENDING_STALE_MINUTES : CREATED_STALE_MINUTES
    if (ageMinutes > threshold) return "INCOMPLETE"
  }

  return status
}

/**
 * Returns the display network label for a payment.
 * Cash payments have no blockchain network; they are explicitly labelled "Cash"
 * using the provider field, mirroring TransactionActivityTable behaviour.
 */
type AssetRow = { network: string; asset: string; gross: number; status: string }

export function buildNetworkAssetLabel(network: string, asset: string): string {
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
  if (network === "bitcoin_lightning" || network === "lightning") return "Bitcoin Lightning"
  if (network === "solana") return "Solana"
  if (network === "base") return "Base"
  if (network === "ethereum") return "Ethereum"
  if (network === "cash") return "Cash"
  if (!network) return "Unknown"

  return String(rawNetwork)
}
