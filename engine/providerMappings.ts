import {
  type PaymentAdapterId,
  type PaymentNetwork,
  normalizePaymentAdapter,
  normalizePaymentNetwork,
  getSupportedNetworksForAdapter,
  getAdapterCredentialKey,
  adapterSupportsNetwork
} from "@/types/payment"

export type WalletAsset =
  | "sol"
  | "sol-usdc"
  | "eth-base"
  | "usdc-base"
  | "shift4"

export type WalletNetwork = PaymentNetwork

export function normalizeProvider(provider?: string): PaymentAdapterId | undefined {
  return normalizePaymentAdapter(provider)
}

export function normalizeWalletNetwork(value?: string): WalletNetwork | null {
  return normalizePaymentNetwork(value)
}

export function getNetworksForAdapter(adapterId?: string): WalletNetwork[] {
  return getSupportedNetworksForAdapter(adapterId)
}

export const ALLOWED_ASSETS: Readonly<Record<WalletAsset, { label: string; network: WalletNetwork; symbol: string }>> = {
  "sol": { label: "SOL", network: "solana", symbol: "SOL" },
  "sol-usdc": { label: "USDC (Solana)", network: "solana", symbol: "USDC" },
  "eth-base": { label: "ETH (Base)", network: "base", symbol: "ETH" },
  "usdc-base": { label: "USDC (Base)", network: "base", symbol: "USDC" },
  "shift4": { label: "Card / Fiat (Shift4)", network: "shift4", symbol: "USD" },
} as const

export function getDefaultNetworkForAdapter(adapterId?: string): WalletNetwork | null {
  return getNetworksForAdapter(adapterId)[0] || null
}

export function adapterCanProcessNetwork(adapterId: string, network: string): boolean {
  return adapterSupportsNetwork(adapterId, network)
}

export function getCredentialKeyForAdapter(adapterId?: string): string | undefined {
  return getAdapterCredentialKey(adapterId)
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
