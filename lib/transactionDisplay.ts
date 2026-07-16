export type TransactionDisplayMetadata = {
  selectedAsset?: string | null
  split?: {
    asset?: string | null
    nativeSymbol?: string | null
  } | null
} | null

const CRYPTO_ASSETS = new Set(["BTC", "ETH", "SOL", "USDC"])

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

export function isLightningTransaction(provider?: string | null, network?: string | null) {
  const p = normalized(provider)
  const n = normalized(network)
  return ["lightning", "lightning_speed", "speed", "tryspeed", "lightning_nwc", "nwc", "bitcoin_lightning", "btc_lightning"].includes(p) ||
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
  const candidates = [split?.asset, split?.nativeSymbol, input.metadata?.selectedAsset]
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
  const status = String(paymentStatus || "").trim().toUpperCase()
  if (status !== "INCOMPLETE") return status || "UNKNOWN"

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    const eventType = normalized(event.event_type)
    const providerEvent = normalized(event.provider_event)
    const reason = event.raw_payload && typeof event.raw_payload === "object"
      ? normalized((event.raw_payload as Record<string, unknown>).reason)
      : ""
    if (["payment.canceled", "payment.cancelled"].includes(eventType) || /cancel|user_rejected/.test(`${providerEvent} ${reason}`)) {
      return "CANCELED"
    }
    if (eventType === "payment.expired" || /expir|timeout/.test(`${providerEvent} ${reason}`)) {
      return "EXPIRED"
    }
  }

  return "CANCELED"
}
