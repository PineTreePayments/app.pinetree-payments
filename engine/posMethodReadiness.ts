import { getMerchantProviders } from "@/database/merchants"
import { getMerchantAvailableNetworks } from "./paymentIntents"
import type { WalletNetwork } from "./providerMappings"
import { canCardProviderProcessPayments } from "@/providers/cardProviderReadiness"
import { getRailsForCategory } from "@/types/payment"

// Derived from the canonical rail definitions (types/payment.ts) rather
// than a manually maintained array - see docs/architecture.md's "No
// duplicate logic allowed" rule and the Stripe-as-crypto POS bug this
// prevents from recurring.
const CRYPTO_RAILS: WalletNetwork[] = getRailsForCategory("crypto")

function normalizeProviderId(provider?: string | null) {
  return String(provider || "").toLowerCase().trim()
}

function isEnabledProvider(provider: { enabled?: boolean }) {
  return provider.enabled !== false
}

export type PosMethodReadiness = {
  cash: boolean
  crypto: boolean
  card: boolean
  cryptoAvailable: boolean
  availableCryptoRails: WalletNetwork[]
  unavailableCryptoRails: WalletNetwork[]
  reason: string | null
}

export async function getPosMethodReadinessEngine(merchantId: string): Promise<PosMethodReadiness> {
  const [availableNetworks, providers] = await Promise.all([
    getMerchantAvailableNetworks(merchantId),
    getMerchantProviders(merchantId)
  ])

  const availableProviderIds = providers.map((provider) => normalizeProviderId(provider.provider))
  const enabledProviderIds = providers
    .filter(isEnabledProvider)
    .map((provider) => normalizeProviderId(provider.provider))

  const availableNetworkSet = new Set(availableNetworks)
  const availableCryptoRails = CRYPTO_RAILS.filter((network) => availableNetworkSet.has(network))
  const unavailableCryptoRails = CRYPTO_RAILS.filter((network) => !availableNetworkSet.has(network))
  const cryptoAvailable = availableCryptoRails.length > 0
  const card = providers.some(canCardProviderProcessPayments)

  const result: PosMethodReadiness = {
    cash: true,
    crypto: cryptoAvailable,
    card,
    cryptoAvailable,
    availableCryptoRails,
    unavailableCryptoRails,
    reason: cryptoAvailable ? null : "No enabled crypto rails are available"
  }

  console.info("[pos-method-readiness]", {
    merchantId,
    availableProviderIds,
    enabledProviderIds,
    availableNetworks,
    result: {
      cash: result.cash,
      cryptoAvailable: result.cryptoAvailable,
      card: result.card,
      availableCryptoRails: result.availableCryptoRails,
      unavailableCryptoRails: result.unavailableCryptoRails,
      reason: result.reason
    }
  })

  return result
}
