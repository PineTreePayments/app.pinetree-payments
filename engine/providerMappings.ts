import { PaymentProvider } from "@/types/payment"

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

export function providerToPreferredNetwork(provider?: string): WalletNetwork | null {
  const p = normalizeProvider(provider)
  if (p === "solana") return "solana"
  if (p === "base") return "base"
  if (p === "coinbase") return "base"
  if (p === "shift4") return "ethereum"
  return null
}
