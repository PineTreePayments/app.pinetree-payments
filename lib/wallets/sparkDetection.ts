// All identifiers that classify a wallet as Spark or Lightning.
// Dynamic SDK may surface these in chain, key, or connector.name.
export const SPARK_LIGHTNING_TOKENS = [
  "spark",
  "lightspark",
  "lightning",
  "bitcoin-lightning",
  "btc-lightning",
] as const

export type NetworkId = "base" | "solana" | "bitcoin" | "lightning"

export function networkForWallet(chain: string, key: string, connectorName: string): NetworkId | null {
  const identity = `${chain} ${key} ${connectorName}`.toLowerCase()
  if (SPARK_LIGHTNING_TOKENS.some((token) => identity.includes(token))) return "lightning"
  if (chain.toUpperCase() === "SOL" || identity.includes("solana")) return "solana"
  if (chain.toUpperCase() === "EVM" || identity.includes("ethereum")) return "base"
  if (chain.toUpperCase() === "BTC" || identity.includes("bitcoin")) return "bitcoin"
  return null
}

export function shortAddress(address: string): string {
  if (address.length <= 26) return address
  return `${address.slice(0, 12)}…${address.slice(-10)}`
}
