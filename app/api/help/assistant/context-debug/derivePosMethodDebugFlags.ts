import type { AssistantRailSummary } from "@/lib/help/pinetreeAssistantContext"

// Keep route helpers outside route.ts: Next App Router route modules may only
// export HTTP handlers and supported route configuration fields.
const CRYPTO_RAIL_PROVIDERS = new Set([
  "solana",
  "base",
  "bitcoin_lightning",
  "lightning",
  "lightning_speed",
  "lightning_nwc",
])
const CARD_RAIL_PROVIDERS = new Set(["shift4", "stripe", "fluidpay"])

export function derivePosMethodDebugFlags(railSummaries: AssistantRailSummary[]): {
  cryptoEnabled: boolean
  cardEnabled: boolean
} {
  return {
    cryptoEnabled: railSummaries.some(
      (rail) => rail.availableForPos && CRYPTO_RAIL_PROVIDERS.has(rail.rail.toLowerCase().trim())
    ),
    cardEnabled: railSummaries.some(
      (rail) => rail.availableForPos && CARD_RAIL_PROVIDERS.has(rail.rail.toLowerCase().trim())
    ),
  }
}
