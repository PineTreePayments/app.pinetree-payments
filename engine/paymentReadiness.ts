import { getMerchantProviders } from "@/database/merchants"
import { getMerchantWallets } from "@/database/merchantWallets"
import {
  assertTreasuryWalletFormat,
  getPineTreeTreasuryWallet
} from "./config"
import { normalizeWalletNetwork, networkToProvider, type WalletNetwork } from "./providerMappings"

type ReadinessNetwork = "solana" | "base" | "ethereum"

type NetworkReadiness = {
  network: ReadinessNetwork
  provider: {
    required: string
    connected: boolean
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
  const connectedProviderSet = new Set(
    connectedProviders.map((row) => String(row.provider || "").toLowerCase())
  )

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
    const requiredProvider = networkToProvider(network)
    const providerConnected = merchantId ? connectedProviderSet.has(requiredProvider) : false
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
      provider: {
        required: requiredProvider,
        connected: providerConnected
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
    (item) => item.provider.connected && item.wallet.connected && item.treasury.configured && item.treasury.validFormat
  )

  return {
    merchantId: merchantId || null,
    readyForCheckout: readyNetworks.length > 0,
    readyNetworks: readyNetworks.map((item) => item.network),
    details
  }
}
