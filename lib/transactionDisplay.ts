export type TransactionDisplayMetadata = {
  selectedAsset?: string | null
  asset?: string | null
  split?: {
    asset?: string | null
    nativeSymbol?: string | null
  } | null
} | null

const CRYPTO_ASSETS = new Set(["BTC", "ETH", "SOL", "USDC"])

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
}

export function isLightningTransaction(provider?: string | null, network?: string | null) {
  const p = normalized(provider)
  const n = normalized(network)
  return ["lightning", "lightning_speed", "speed", "tryspeed", "try_speed", "speed_lightning", "lightning_nwc", "nwc", "nwc_lightning", "bitcoin_lightning", "btc_lightning", "lightning_btc"].includes(p) ||
    ["bitcoin_lightning", "btc_lightning", "lightning_btc", "lightning"].includes(n)
}

export function normalizeTransactionAsset(input: {
  provider?: string | null
  network?: string | null
  currency?: string | null
  metadata?: TransactionDisplayMetadata
}): string {
  const provider = normalized(input.provider)
  const network = normalized(input.network)

  if (provider === "cash" || provider === "stripe" || provider === "shift4" || provider === "fluidpay") {
    return "USD"
  }
  if (isLightningTransaction(provider, network)) return "BTC"

  const split = input.metadata?.split
  const candidates = [split?.asset, split?.nativeSymbol, input.metadata?.selectedAsset, input.metadata?.asset]
  for (const candidate of candidates) {
    const asset = String(candidate || "").trim().toUpperCase()
    if (!CRYPTO_ASSETS.has(asset)) continue
    if (network === "solana" && (asset === "SOL" || asset === "USDC")) return asset
    if (network === "base" && (asset === "ETH" || asset === "USDC")) return asset
  }

  return "Unknown asset"
}

export type TransactionLifecycleEvent = {
  event_type?: string | null
  provider_event?: string | null
  raw_payload?: unknown
  created_at?: string | null
}

export function resolveLifecycleDisplayStatus(
  paymentStatus: string | null | undefined,
  events: TransactionLifecycleEvent[]
): string {
  void events
  const status = String(paymentStatus || "").trim().toUpperCase()
  if (status === "CANCELLED") return "CANCELED"
  return status || "UNKNOWN"
}
