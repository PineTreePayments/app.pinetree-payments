export function isCashTransactionProvider(provider: string | null | undefined) {
  return String(provider || "").trim().toLowerCase() === "cash"
}

export function cashTransactionSecondaryLabel(provider: string | null | undefined) {
  return isCashTransactionProvider(provider) ? "USD" : null
}

export function formatTransactionProviderLabel(provider: string | null | undefined) {
  const normalized = String(provider || "").trim().toLowerCase()

  if (
    normalized === "lightning_speed" ||
    normalized === "speed" ||
    normalized === "tryspeed" ||
    normalized === "try_speed" ||
    normalized === "speed_lightning"
  ) return "Speed"

  if (
    normalized === "lightning_nwc" ||
    normalized === "nwc" ||
    normalized === "nwc_lightning"
  ) return "NWC"

  if (
    normalized === "lightning" ||
    normalized === "bitcoin_lightning" ||
    normalized === "bitcoin lightning" ||
    normalized === "btc_lightning" ||
    normalized === "lightning_btc"
  ) return "Lightning"

  if (normalized === "solana") return "Solana Pay"
  if (normalized === "base") return "Base Pay"
  if (normalized === "coinbase") return "Coinbase Business"
  if (normalized === "shift4") return "Shift4"
  if (normalized === "cash") return "Cash"

  return String(provider || "Unknown")
}
