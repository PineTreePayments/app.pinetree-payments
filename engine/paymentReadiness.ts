import { getMerchantProviders } from "@/database/merchants"
import { getMerchantWallets } from "@/database/merchantWallets"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE
} from "@/providers/lightning/speedClient"
import {
  normalizePaymentAdapter,
  adapterSupportsNetwork,
  type PaymentAdapterId
} from "@/types/payment"
import {
  assertTreasuryWalletFormat,
  getPineTreeTreasuryWallet
} from "./config"
import { normalizeWalletNetwork, type WalletNetwork } from "./providerMappings"
import { isProviderHealthy } from "./providerRegistry"
import { buildPineTreeRailReadiness } from "@/lib/pinetreeRailReadiness"
import { getMerchantBusinessProfile } from "./businessProfile"

type ReadinessNetwork = "solana" | "base" | "bitcoin_lightning"

type NetworkReadiness = {
  network: ReadinessNetwork
  adapters: {
    available: boolean
    connected: string[]
  }
  wallet: {
    connected: boolean
    addressPreview?: string
  }
  treasury: {
    configured: boolean
    validFormat: boolean
    addressPreview?: string
    error?: string
  }
}

function maskAddress(address?: string | null): string | undefined {
  const value = String(address || "").trim()
  if (!value) return undefined
  if (value.startsWith("0x") && value.length > 10) {
    return `${value.slice(0, 6)}...${value.slice(-4)}`
  }
  if (value.length > 10) {
    return `${value.slice(0, 4)}...${value.slice(-4)}`
  }
  return value
}

export async function getPaymentReadinessEngine(input: { merchantId?: string }) {
  const merchantId = String(input.merchantId || "").trim() || undefined

  const networks: ReadinessNetwork[] = ["solana", "base", "bitcoin_lightning"]

  const [connectedProviders, lightningProfile, businessProfile] = merchantId
    ? await Promise.all([
        getMerchantProviders(merchantId),
        getMerchantLightningProfile(merchantId),
        getMerchantBusinessProfile(merchantId)
      ])
    : [[], null, null]
  const connectedAdapterIds = connectedProviders
    .map((row) => normalizePaymentAdapter(String(row.provider || "")))
    .filter((value): value is PaymentAdapterId => Boolean(value))

  const wallets = merchantId ? await getMerchantWallets(merchantId) : []
  const pineTreeWalletProfile = merchantId ? await getPineTreeWalletProfile(merchantId) : null
  const walletByNetwork = new Map<WalletNetwork, string>()

  for (const wallet of wallets) {
    const normalized = normalizeWalletNetwork(wallet.network)
    const address = String(wallet.wallet_address || "").trim()
    if (!normalized || !address) continue
    if (!walletByNetwork.has(normalized)) {
      walletByNetwork.set(normalized, address)
    }
  }

  // When canonical wallet mode is active, the PineTree Wallet profile is
  // authoritative for solana/base — use it as a fallback if merchant_wallets
  // hasn't been synced yet (e.g. first load before rail sync runs).
  const canonicalWalletMode = process.env.PINE_TREE_WALLET_CANONICAL === "true"
  if (canonicalWalletMode && pineTreeWalletProfile) {
    if (!walletByNetwork.has("solana") && pineTreeWalletProfile.solana_address) {
      walletByNetwork.set("solana", pineTreeWalletProfile.solana_address)
    }
    if (!walletByNetwork.has("base") && pineTreeWalletProfile.base_address) {
      walletByNetwork.set("base", pineTreeWalletProfile.base_address)
    }
  }

  const details: NetworkReadiness[] = networks.map((network) => {
    const connectedAdaptersForNetwork = merchantId
      ? connectedAdapterIds.filter(
          (adapterId) => adapterSupportsNetwork(adapterId, network) && isProviderHealthy(adapterId)
        )
      : []
    const walletAddress = merchantId ? walletByNetwork.get(network) : undefined

    const speedProvider = connectedProviders.find(
      (provider) => String(provider.provider || "").toLowerCase().trim() === SPEED_PROVIDER_NAME
    )
    if (network === "bitcoin_lightning") {
      const speedConfig = getPineTreeSpeedConfigStatus()
      if (isSpeedPlatformTreasurySweepEnabled()) {
        const btcAddress = String(pineTreeWalletProfile?.btc_address || "").trim()
        const btcPayoutReady = Boolean(btcAddress && pineTreeWalletProfile?.btc_payout_enabled)
        const merchantLightningEnabled = speedProvider?.enabled !== false
        const speedReady = Boolean(speedConfig.configured && merchantLightningEnabled)
        return {
          network,
          adapters: {
            available: speedReady,
            connected: speedReady ? [SPEED_PROVIDER_NAME] : []
          },
          wallet: {
            connected: btcPayoutReady,
            addressPreview: maskAddress(btcAddress) || "PineTree managed"
          },
          treasury: {
            configured: speedConfig.configured,
            validFormat: speedConfig.configured,
            addressPreview: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
            error: speedConfig.configured ? undefined : speedConfig.missing.join(", ")
          }
        }
      }
      const speedCredentials = (speedProvider?.credentials || {}) as {
        speed_account_id?: string
        setup_status?: string
      }
      const speedAccountId = String(speedCredentials.speed_account_id || "").trim()
      const setupStatus = String(speedCredentials.setup_status || "").trim()
      const speedReady = Boolean(
        speedConfig.configured &&
        speedProvider?.enabled !== false &&
        speedAccountId &&
        (setupStatus === "ready_for_payments" || setupStatus === "ready")
      )

      return {
        network,
        adapters: {
          available: Boolean(speedProvider && speedReady),
          connected: speedProvider ? [SPEED_PROVIDER_NAME] : []
        },
        wallet: {
          connected: Boolean(speedAccountId),
          addressPreview: maskAddress(speedAccountId)
        },
        treasury: {
          configured: speedConfig.configured,
          validFormat: speedConfig.configured,
          addressPreview: undefined,
          error: speedConfig.configured ? undefined : speedConfig.missing.join(", ")
        }
      }
    }

    let treasuryAddress = ""
    let configured = false
    let validFormat = false
    let treasuryError: string | undefined

    try {
      treasuryAddress = getPineTreeTreasuryWallet(network)
      configured = Boolean(String(treasuryAddress || "").trim())

      assertTreasuryWalletFormat(network)
      validFormat = true
    } catch (error) {
      treasuryError = error instanceof Error ? error.message : "Invalid treasury configuration"
    }

    return {
      network,
      adapters: {
        available: connectedAdaptersForNetwork.length > 0,
        connected: connectedAdaptersForNetwork
      },
      wallet: {
        connected: Boolean(walletAddress),
        addressPreview: maskAddress(walletAddress)
      },
      treasury: {
        configured,
        validFormat,
        addressPreview: maskAddress(treasuryAddress),
        error: treasuryError
      }
    }
  })

  const speedProvider = connectedProviders.find(
    (provider) => String(provider.provider || "").toLowerCase().trim() === SPEED_PROVIDER_NAME
  )
  const speedCredentials = (speedProvider?.credentials || {}) as {
    speed_account_id?: string
    account_id?: string
    setup_status?: string
  }
  const speedConfig = getPineTreeSpeedConfigStatus()
  const speedAccountReady = Boolean(
    lightningProfile?.status === "ready" ||
    (
      String(speedCredentials.speed_account_id || speedCredentials.account_id || "").trim() &&
      (String(speedCredentials.setup_status || "").trim() === "ready" ||
        String(speedCredentials.setup_status || "").trim() === "ready_for_payments")
    )
  )
  const railReadiness = buildPineTreeRailReadiness({
    providers: connectedProviders,
    walletProfile: pineTreeWalletProfile,
    speed: {
      configured: speedConfig.configured,
      accountReady: speedAccountReady,
      payoutReady: Boolean(speedAccountReady && pineTreeWalletProfile?.btc_payout_enabled),
      status: lightningProfile?.status || String(speedCredentials.setup_status || "")
    },
    businessProfileComplete: businessProfile?.profile_status === "complete"
  })

  const supportedIntentNetworks = details.filter((item) =>
    item.network === "solana" || item.network === "base" || item.network === "bitcoin_lightning"
  )
  const readyNetworks = supportedIntentNetworks.filter((item) => railReadiness[item.network].paymentReady)

  return {
    merchantId: merchantId || null,
    readyForCheckout: readyNetworks.length > 0,
    readyNetworks: readyNetworks.map((item) => item.network),
    details
  }
}
