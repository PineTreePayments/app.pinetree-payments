export function formatWalletTotalBalance(
  totalUsd: number | null | undefined,
  syncing: boolean
) {
  if (syncing) return "Syncing..."
  if (typeof totalUsd !== "number" || !Number.isFinite(totalUsd)) return "\u2014"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(totalUsd)
}
