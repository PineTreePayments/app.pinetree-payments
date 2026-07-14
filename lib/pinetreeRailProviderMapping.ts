export type PineTreeWalletRail = "base" | "solana" | "bitcoin"
export type InternalPineTreeRailProvider = "dynamic" | "speed"

export const PINETREE_INTERNAL_RAIL_PROVIDER: Record<PineTreeWalletRail, InternalPineTreeRailProvider> = {
  base: "dynamic",
  solana: "dynamic",
  bitcoin: "speed",
} as const

