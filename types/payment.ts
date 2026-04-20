export type PaymentAdapterId =
  | "coinbase"
  | "shift4"
  | "solana"
  | "base"

// Backwards-compatible alias while the codebase is refactored from
// provider-centric naming to adapter-centric naming.
export type PaymentProvider = PaymentAdapterId

export type PaymentNetwork =
  | "solana"
  | "base"
  | "ethereum"
  | "shift4"

export const PAYMENT_ADAPTER_NETWORKS: Readonly<Record<PaymentAdapterId, readonly PaymentNetwork[]>> = {
  solana: ["solana"],
  base: ["base", "ethereum"],
  coinbase: ["base"],
  shift4: ["shift4"]
} as const

export const PAYMENT_ADAPTER_CREDENTIAL_KEYS: Readonly<Partial<Record<PaymentAdapterId, string>>> = {
  coinbase: "coinbase_api_key",
  shift4: "shift4_api_key"
} as const

export function normalizePaymentAdapter(value?: string): PaymentAdapterId | undefined {
  const normalized = String(value || "").toLowerCase().trim()

  if (
    normalized === "coinbase" ||
    normalized === "shift4" ||
    normalized === "solana" ||
    normalized === "base"
  ) {
    return normalized as PaymentAdapterId
  }

  return undefined
}

export function normalizePaymentNetwork(value?: string): PaymentNetwork | null {
  const normalized = String(value || "").toLowerCase().trim()

  if (normalized === "solana" || normalized === "base" || normalized === "ethereum" || normalized === "shift4") {
    return normalized as PaymentNetwork
  }

  return null
}

export function getSupportedNetworksForAdapter(adapterId?: string): PaymentNetwork[] {
  const normalized = normalizePaymentAdapter(adapterId)
  if (!normalized) return []
  return [...PAYMENT_ADAPTER_NETWORKS[normalized]]
}

export function adapterSupportsNetwork(adapterId: string, network: string): boolean {
  const normalizedNetwork = normalizePaymentNetwork(network)
  if (!normalizedNetwork) return false
  return getSupportedNetworksForAdapter(adapterId).includes(normalizedNetwork)
}

export function getAdapterCredentialKey(adapterId?: string): string | undefined {
  const normalized = normalizePaymentAdapter(adapterId)
  if (!normalized) return undefined
  return PAYMENT_ADAPTER_CREDENTIAL_KEYS[normalized]
}

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "INCOMPLETE"
  | "EXPIRED"
  | "REFUNDED"