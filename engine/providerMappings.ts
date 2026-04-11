import { PaymentProvider } from "@/types/payment"

export type WalletAsset =
  | "sol"
  | "sol-usdc"
  | "eth-base"
  | "eth-ethereum"
  | "usdc-base"
  | "usdc-ethereum"

export type WalletNetwork = "solana" | "base" | "ethereum"

export function normalizeProvider(provider?: string): PaymentProvider | undefined {
  const value = String(provider || "").toLowerCase().trim()
  if (value === "solana" || value === "coinbase" || value === "shift4" || value === "base") {
    return value as PaymentProvider
  }
  return undefined
}

export function normalizeWalletNetwork(value?: string): WalletNetwork | null {
  const network = String(value || "").toLowerCase().trim()
  if (network === "solana" || network === "base" || network === "ethereum") return network
  return null
}

export function networkToProvider(network: WalletNetwork): PaymentProvider {
  if (network === "solana") return "solana"
  if (network === "base") return "base"
  return "shift4"
}

export const ALLOWED_ASSETS: Readonly<Record<WalletAsset, { label: string; network: WalletNetwork; symbol: string }>> = {
  "sol": { label: "SOL", network: "solana", symbol: "SOL" },
  "sol-usdc": { label: "USDC (Solana)", network: "solana", symbol: "USDC" },
  "eth-base": { label: "ETH (Base)", network: "base", symbol: "ETH" },
  "eth-ethereum": { label: "ETH (Ethereum)", network: "ethereum", symbol: "ETH" },
  "usdc-base": { label: "USDC (Base)", network: "base", symbol: "USDC" },
  "usdc-ethereum": { label: "USDC (Ethereum)", network: "ethereum", symbol: "USDC" },
} as const

export function providerToPreferredNetwork(provider?: string): WalletNetwork | null {
  const p = normalizeProvider(provider)
  if (p === "solana") return "solana"
  if (p === "base") return "base"
  if (p === "coinbase") return "base"
  if (p === "shift4") return "ethereum"
  return null
}

export function getAvailableAssetsForNetworks(networks: WalletNetwork[]): WalletAsset[] {
  return Object.entries(ALLOWED_ASSETS)
    .filter(([, asset]) => networks.includes(asset.network))
    .map(([id]) => id as WalletAsset)
}

export function getAvailableAssetsFromValues(values: string[]): WalletAsset[] {
  const normalizedNetworks = values
    .map((value) => normalizeWalletNetwork(value))
    .filter((value): value is WalletNetwork => Boolean(value))

  return getAvailableAssetsForNetworks(normalizedNetworks)
}
