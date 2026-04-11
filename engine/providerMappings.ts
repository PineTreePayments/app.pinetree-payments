import { PaymentProvider } from "@/types/payment"

export type WalletNetwork = "solana" | "base" | "ethereum"

export function normalizeProvider(provider?: string): PaymentProvider | undefined {
  const value = String(provider || "").toLowerCase().trim()
  if (value === "solana" || value === "coinbase" || value === "shift4") {
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
  if (network === "base") return "coinbase"
  return "shift4"
}

export function providerToPreferredNetwork(provider?: string): WalletNetwork | null {
  const p = normalizeProvider(provider)
  if (p === "solana") return "solana"
  if (p === "coinbase") return "base"
  if (p === "shift4") return "ethereum"
  return null
}
