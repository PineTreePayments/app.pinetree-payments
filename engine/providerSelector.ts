/**
 * PineTree Adapter Selector & Smart Routing
 * 
 * Engine-owned selection of the best available adapter for a merchant
 * based on network support, merchant configuration, and adapter health.
 */

import { getMerchantDefaultProvider, getMerchantProviders } from "@/database/merchants"
import type { PaymentAdapterId } from "@/types/payment"
import { normalizeProvider, normalizeWalletNetwork } from "./providerMappings"
import { getProviderMetadata, isProviderHealthy, providerSupportsFeeAtPaymentTime } from "./providerRegistry"
import { loadProviders } from "./loadProviders"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { merchantProviderCanProcessPayments } from "@/lib/providers/cardProviderReadiness"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled
} from "@/providers/lightning/speedClient"

// Wallet-rail adapter per network — used when merchant_providers has no rows yet
const NETWORK_DEFAULT_ADAPTER: Partial<Record<string, PaymentAdapterId>> = {
  solana: "solana",
  base: "base"
}

function adapterMeetsNetworkRequirements(adapterId: PaymentAdapterId, network: string): boolean {
  if (network === "bitcoin_lightning") {
    if (adapterId === SPEED_PROVIDER_NAME) return providerSupportsFeeAtPaymentTime(adapterId)
    // NWC collects PineTree fees post-payment via merchant-authorized pay_invoice.
    // It deliberately does not capture fees at payment time — that is correct by design.
    if (adapterId === "lightning_nwc") return true
    return providerSupportsFeeAtPaymentTime(adapterId)
  }

  return true
}

function sortAdapterIds(
  adapterIds: PaymentAdapterId[],
  defaultAdapterId?: PaymentAdapterId | null
): PaymentAdapterId[] {
  const preferred = String(defaultAdapterId || "").toLowerCase().trim()
  return [...adapterIds].sort((left, right) => {
    if (!preferred && left === SPEED_PROVIDER_NAME && right !== SPEED_PROVIDER_NAME) return -1
    if (!preferred && right === SPEED_PROVIDER_NAME && left !== SPEED_PROVIDER_NAME) return 1
    if (left === preferred && right !== preferred) return -1
    if (right === preferred && left !== preferred) return 1
    return left.localeCompare(right)
  })
}

/**
 * Choose the best available adapter for a merchant network.
 */
export async function chooseBestAdapter(input: {
  merchantId: string
  network: string
  requestedAdapterId?: string
}): Promise<PaymentAdapterId | null> {
  await loadProviders()

  const network = normalizeWalletNetwork(input.network)
  if (!network) {
    throw new Error("Unsupported payment network")
  }

  const merchantProviders = await getMerchantProviders(input.merchantId)
  const connectedAdapterIds = merchantProviders
    .filter(merchantProviderCanProcessPayments)
    .map((provider) => normalizeProvider(provider.provider))
    .filter((value): value is PaymentAdapterId => Boolean(value))
  const speedTreasurySweepReady =
    network === "bitcoin_lightning" &&
    isSpeedPlatformTreasurySweepEnabled() &&
    getPineTreeSpeedConfigStatus().configured
  if (speedTreasurySweepReady && !connectedAdapterIds.includes(SPEED_PROVIDER_NAME)) {
    connectedAdapterIds.push(SPEED_PROVIDER_NAME)
  }

  const defaultAdapterId = normalizeProvider(
    String(await getMerchantDefaultProvider(input.merchantId) || "")
  )

  const requestedAdapterId = normalizeProvider(input.requestedAdapterId)

  if (requestedAdapterId) {
    const metadata = getProviderMetadata(requestedAdapterId)
    if (!connectedAdapterIds.includes(requestedAdapterId)) {
      throw new Error(`Requested payment adapter is not connected: ${requestedAdapterId}`)
    }
    if (!metadata || !metadata.supportedNetworks.includes(network)) {
      throw new Error(`Requested payment adapter does not support ${network}`)
    }
    if (!adapterMeetsNetworkRequirements(requestedAdapterId, network)) {
      throw new Error(`Requested payment adapter does not meet network requirements for ${network}`)
    }
    if (!isProviderHealthy(requestedAdapterId)) {
      throw new Error(`Requested payment adapter is unhealthy: ${requestedAdapterId}`)
    }
    return requestedAdapterId
  }

  const candidates = connectedAdapterIds.filter((adapterId) => {
    const metadata = getProviderMetadata(adapterId)
    return Boolean(
      metadata &&
      metadata.supportedNetworks.includes(network) &&
      adapterMeetsNetworkRequirements(adapterId, network) &&
      isProviderHealthy(adapterId)
    )
  })

  const sortedCandidates = sortAdapterIds(candidates, defaultAdapterId)
  if (sortedCandidates[0]) return sortedCandidates[0]

  // No merchant_providers rows yet — infer the wallet-rail adapter from network
  const inferredAdapter = NETWORK_DEFAULT_ADAPTER[network]
  if (inferredAdapter && isProviderHealthy(inferredAdapter)) {
    return inferredAdapter
  }

  return null
}

/**
 * Get available payment networks for a merchant
 */
export async function getAvailableNetworks(merchantId: string) {
  await loadProviders()

  const providers = await getMerchantProviders(merchantId)

  const networks = new Set<string>()

  for (const provider of providers) {
    if (!merchantProviderCanProcessPayments(provider)) continue

    const adapterId = normalizeProvider(provider.provider)
    const metadata = adapterId ? getProviderMetadata(adapterId) : null

    if (adapterId && metadata && isProviderHealthy(adapterId)) {
      metadata.supportedNetworks.forEach((network) => networks.add(network))
    }
  }

  return [...networks]
}
