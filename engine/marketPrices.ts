/**
 * PineTree Market Prices Engine
 *
 * Single source of truth for USD market pricing.
 */

export type MarketPricesUSD = {
  SOL: number
  ETH: number
}

const PRICE_CACHE_TTL_MS = 60_000

const FALLBACK_PRICES_USD: MarketPricesUSD = {
  SOL: Number(process.env.FALLBACK_SOL_USD || 80),
  ETH: Number(process.env.FALLBACK_ETH_USD || 2000)
}

let cachedPrices: { value: MarketPricesUSD; updatedAt: number } | null = null

function isValidPrice(value: number) {
  return Number.isFinite(value) && value > 0
}

function normalizePrices(input?: Partial<MarketPricesUSD> | null): MarketPricesUSD {
  const sol = Number(input?.SOL ?? 0)
  const eth = Number(input?.ETH ?? 0)

  return {
    SOL: isValidPrice(sol) ? sol : FALLBACK_PRICES_USD.SOL,
    ETH: isValidPrice(eth) ? eth : FALLBACK_PRICES_USD.ETH
  }
}

function getFreshCachedPrices(): MarketPricesUSD | null {
  if (!cachedPrices) return null
  const isFresh = Date.now() - cachedPrices.updatedAt < PRICE_CACHE_TTL_MS
  return isFresh ? cachedPrices.value : null
}

function updateCache(value: MarketPricesUSD) {
  cachedPrices = {
    value,
    updatedAt: Date.now()
  }
}

export async function getMarketPricesUSD(): Promise<MarketPricesUSD> {
  const freshCached = getFreshCachedPrices()
  if (freshCached) {
    return freshCached
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4500)

    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum&vs_currencies=usd",
      {
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" }
      }
    )

    clearTimeout(timeout)

    if (!res.ok) {
      return cachedPrices?.value || FALLBACK_PRICES_USD
    }

    const data = await res.json()

    const sol = Number(data?.solana?.usd ?? 0)
    const eth = Number(data?.ethereum?.usd ?? 0)

    const resolved = normalizePrices({ SOL: sol, ETH: eth })
    updateCache(resolved)

    return resolved
  } catch {
    return cachedPrices?.value || FALLBACK_PRICES_USD
  }
}
