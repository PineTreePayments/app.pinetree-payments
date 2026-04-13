import { getMerchantProviders } from "@/database/merchants"
import { getMerchantWallets } from "@/database/merchantWallets"
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

type ReadinessNetwork = "solana" | "base" | "ethereum"

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

  const networks: ReadinessNetwork[] = ["solana", "base", "ethereum"]

  const connectedProviders = merchantId ? await getMerchantProviders(merchantId) : []
  const connectedAdapterIds = connectedProviders
    .map((row) => normalizePaymentAdapter(String(row.provider || "")))
    .filter((value): value is PaymentAdapterId => Boolean(value))

  const wallets = merchantId ? await getMerchantWallets(merchantId) : []
  const walletByNetwork = new Map<WalletNetwork, string>()

  for (const wallet of wallets) {
    const normalized = normalizeWalletNetwork(wallet.network)
    const address = String(wallet.wallet_address || "").trim()
    if (!normalized || !address) continue
    if (!walletByNetwork.has(normalized)) {
      walletByNetwork.set(normalized, address)
    }
  }

  const details: NetworkReadiness[] = networks.map((network) => {
    const connectedAdaptersForNetwork = merchantId
      ? connectedAdapterIds.filter(
          (adapterId) => adapterSupportsNetwork(adapterId, network) && isProviderHealthy(adapterId)
        )
      : []
    const walletAddress = merchantId ? walletByNetwork.get(network) : undefined

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

  const supportedIntentNetworks = details.filter((item) => item.network === "solana" || item.network === "base")
  const readyNetworks = supportedIntentNetworks.filter(
    (item) => item.adapters.available && item.wallet.connected && item.treasury.configured && item.treasury.validFormat
  )

  return {
    merchantId: merchantId || null,
    readyForCheckout: readyNetworks.length > 0,
    readyNetworks: readyNetworks.map((item) => item.network),
    details
  }
}
