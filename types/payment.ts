export type PaymentAdapterId =
  | "coinbase"
  | "shift4"
  | "stripe"
  | "fluidpay"
  | "solana"
  | "base"
  | "lightning_speed"
  | "lightning_nwc"

// Backwards-compatible alias while the codebase is refactored from
// provider-centric naming to adapter-centric naming.
export type PaymentProvider = PaymentAdapterId

export type PaymentNetwork =
  | "solana"
  | "base"
  | "shift4"
  | "stripe"
  | "fluidpay"
  | "bitcoin_lightning"

export const PAYMENT_ADAPTER_NETWORKS: Readonly<Record<PaymentAdapterId, readonly PaymentNetwork[]>> = {
  solana: ["solana"],
  base: ["base"],
  coinbase: ["base"],
  shift4: ["shift4"],
  stripe: ["stripe"],
  fluidpay: ["fluidpay"],
  lightning_speed: ["bitcoin_lightning"],
  lightning_nwc: ["bitcoin_lightning"]
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
    normalized === "stripe" ||
    normalized === "fluidpay" ||
    normalized === "solana" ||
    normalized === "base" ||
    normalized === "lightning_speed" ||
    normalized === "speed" ||
    normalized === "lightning_nwc"
  ) {
    return (normalized === "speed" ? "lightning_speed" : normalized) as PaymentAdapterId
  }

  return undefined
}

export function normalizePaymentNetwork(value?: string): PaymentNetwork | null {
  const normalized = String(value || "").toLowerCase().trim()

  if (
    normalized === "solana" ||
    normalized === "base" ||
    normalized === "shift4" ||
    normalized === "stripe" ||
    normalized === "fluidpay" ||
    normalized === "bitcoin_lightning" ||
    normalized === "lightning" ||
    normalized === "btc_lightning" ||
    normalized === "lightning_btc"
  ) {
    if (
      normalized === "lightning" ||
      normalized === "btc_lightning" ||
      normalized === "lightning_btc"
    ) {
      return "bitcoin_lightning"
    }
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

// ── Canonical payment rail classification ───────────────────────────────────
//
// Single source of truth for "is this network card or crypto" and "which
// rails belong to a given customer-facing channel." A provider COMPANY
// (Stripe, Speed, Dynamic, Fireblocks) is never the same thing as a payment
// RAIL - a provider may power a rail, hold wallet infrastructure, or provide
// merchant onboarding without ever becoming a customer-facing payment
// method. See docs/architecture.md and the Stripe-as-crypto POS
// investigation (engine/posPayments.ts) for why this must never be derived
// by negation (e.g. "anything that isn't shift4 must be crypto").
//
// This file has zero imports and sits below engine/ and providers/ in the
// dependency graph on purpose - engine/paymentIntents.ts,
// engine/posMethodReadiness.ts, and provider adapters all read from here,
// never the other way around.

export type PaymentRailCategory = "card" | "crypto"

export type PaymentRailChannel = "pos" | "checkout" | "api"

export type PaymentRailDefinition = {
  id: PaymentNetwork
  category: PaymentRailCategory
  /** False for a rail that exists in the type system but is never offered to a paying customer directly. */
  customerFacing: boolean
  supportedChannels: readonly PaymentRailChannel[]
  /**
   * The merchant_providers.provider key (or canonical alias) whose
   * connection readiness gates this rail. bitcoin_lightning's real
   * eligibility check also accepts synonyms (SPEED_PROVIDER_NAME,
   * "lightning_nwc") - see engine/paymentIntents.ts's
   * isProviderAvailableForCheckout, which is the actual readiness gate.
   * This field is the primary/nominal key only.
   */
  providerCapability: string
}

// Declared in this exact key order so Object.values()-derived lists
// (getRailsForCategory("crypto") in particular) preserve the same
// [solana, base, bitcoin_lightning] order every existing caller already
// depends on.
export const PAYMENT_RAIL_DEFINITIONS: Readonly<Record<PaymentNetwork, PaymentRailDefinition>> = {
  solana: {
    id: "solana",
    category: "crypto",
    customerFacing: true,
    supportedChannels: ["pos", "checkout", "api"],
    providerCapability: "solana"
  },
  base: {
    id: "base",
    category: "crypto",
    customerFacing: true,
    supportedChannels: ["pos", "checkout", "api"],
    providerCapability: "base"
  },
  bitcoin_lightning: {
    id: "bitcoin_lightning",
    category: "crypto",
    customerFacing: true,
    supportedChannels: ["pos", "checkout", "api"],
    providerCapability: "lightning"
  },
  shift4: {
    id: "shift4",
    category: "card",
    customerFacing: true,
    supportedChannels: ["checkout", "api"],
    providerCapability: "shift4"
  },
  stripe: {
    id: "stripe",
    category: "card",
    customerFacing: true,
    supportedChannels: ["pos", "checkout", "api"],
    providerCapability: "stripe"
  },
  fluidpay: {
    id: "fluidpay",
    category: "card",
    customerFacing: true,
    supportedChannels: ["checkout", "api"],
    providerCapability: "fluidpay"
  }
} as const

export function getPaymentRailDefinition(network: PaymentNetwork): PaymentRailDefinition {
  return PAYMENT_RAIL_DEFINITIONS[network]
}

export function isCardRail(network?: string): boolean {
  const normalized = normalizePaymentNetwork(network)
  return normalized ? PAYMENT_RAIL_DEFINITIONS[normalized].category === "card" : false
}

export function isCryptoRail(network?: string): boolean {
  const normalized = normalizePaymentNetwork(network)
  return normalized ? PAYMENT_RAIL_DEFINITIONS[normalized].category === "crypto" : false
}

/** Every canonical rail id in a category, independent of any merchant's actual provider connections. */
export function getRailsForCategory(category: PaymentRailCategory): PaymentNetwork[] {
  return (Object.values(PAYMENT_RAIL_DEFINITIONS) as PaymentRailDefinition[])
    .filter((rail) => rail.category === category)
    .map((rail) => rail.id)
}

/** Every canonical rail id available on a given customer-facing channel. */
export function getRailsForChannel(channel: PaymentRailChannel): PaymentNetwork[] {
  return (Object.values(PAYMENT_RAIL_DEFINITIONS) as PaymentRailDefinition[])
    .filter((rail) => rail.supportedChannels.includes(channel))
    .map((rail) => rail.id)
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
  | "UNKNOWN"

export type BaseUsdcStrategy = "v7_eip3009_relayer"

export type PaymentSplitMetadata = {
  merchantWallet?: string
  pinetreeWallet?: string
  expectedAmountNative?: number
  merchantNativeAmount?: number
  feeNativeAmount?: number
  merchantNativeAmountAtomic?: string | number
  feeNativeAmountAtomic?: string | number
  expectedMerchantAtomic?: string | number
  expectedFeeAtomic?: string | number
  feeCaptureMethod?: string
  splitContract?: string
  asset?: string
  baseUsdcStrategy?: BaseUsdcStrategy
  /** V6+: contract version tag written at payment creation time. */
  baseVersion?: "v6"
  /** V6+: actual runtime strategy the server resolved at payment creation. */
  baseStrategy?: string
  /** V6+: wallet family detected at checkout time (set post-execution). */
  baseWalletFamily?: string
}

export type StoredPaymentSplitMetadata = {
  split?: PaymentSplitMetadata
}
