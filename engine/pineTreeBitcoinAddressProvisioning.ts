import {
  inferBtcAddressType,
  normalizeBtcAddressType,
  type BtcAddressType,
  type PineTreeWalletProfile,
} from "@/database/pineTreeWalletProfiles"
import {
  getOrCreateMerchantBitcoinAddress,
  isFireblocksBitcoinWalletConfigured,
} from "@/providers/wallets/fireblocksBitcoin"

export type PineTreeBtcWalletProvider =
  | "dynamic"
  | "fireblocks"
  | "speed"
  | "manual_internal"
  | "none"

export type BitcoinAddressProvisioningStatus =
  | "ready"
  | "missing_provider"
  | "provider_failed"
  | "already_exists"

export type BitcoinAddressProvisioningResult = {
  btcAddress: string | null
  btcAddressType: BtcAddressType
  btcWalletProvider: PineTreeBtcWalletProvider
  status: BitcoinAddressProvisioningStatus
  providerRef?: string | null
  error?: string
}

function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Bitcoin wallet provider failed"
  return message.slice(0, 240)
}

export async function provisionMerchantBitcoinAddress({
  merchantId,
  existingProfile,
  dynamicBtcAddress,
  dynamicBtcAddressType,
}: {
  merchantId: string
  existingProfile?: PineTreeWalletProfile | null
  dynamicBtcAddress?: string | null
  dynamicBtcAddressType?: string | null
}): Promise<BitcoinAddressProvisioningResult> {
  const existingAddress = String(existingProfile?.btc_address || "").trim()
  if (existingAddress) {
    return {
      btcAddress: existingAddress,
      btcAddressType: existingProfile?.btc_address_type || inferBtcAddressType(existingAddress),
      btcWalletProvider: (existingProfile?.btc_wallet_provider as PineTreeBtcWalletProvider | null) || "manual_internal",
      status: "already_exists",
      providerRef: existingProfile?.btc_wallet_provider_ref || null,
    }
  }

  const dynamicAddress = String(dynamicBtcAddress || "").trim()
  if (dynamicAddress) {
    const explicitDynamicType = normalizeBtcAddressType(dynamicBtcAddressType)
    return {
      btcAddress: dynamicAddress,
      btcAddressType: explicitDynamicType !== "unknown" ? explicitDynamicType : inferBtcAddressType(dynamicAddress),
      btcWalletProvider: "dynamic",
      status: "ready",
      providerRef: null,
    }
  }

  const configuredProvider = String(process.env.PINE_TREE_BTC_WALLET_PROVIDER || "").trim().toLowerCase()
  if (!configuredProvider) {
    return {
      btcAddress: null,
      btcAddressType: "unknown",
      btcWalletProvider: "none",
      status: "missing_provider",
      error: "No Bitcoin wallet provider configured",
    }
  }

  if (configuredProvider !== "fireblocks") {
    return {
      btcAddress: null,
      btcAddressType: "unknown",
      btcWalletProvider: "none",
      status: "missing_provider",
      error: `Unsupported Bitcoin wallet provider: ${configuredProvider}`,
    }
  }

  if (!isFireblocksBitcoinWalletConfigured()) {
    return {
      btcAddress: null,
      btcAddressType: "unknown",
      btcWalletProvider: "fireblocks",
      status: "provider_failed",
      error: "Fireblocks Bitcoin wallet provider is not configured",
    }
  }

  try {
    const address = await getOrCreateMerchantBitcoinAddress(merchantId)
    return {
      btcAddress: address.btcAddress,
      btcAddressType: address.btcAddressType,
      btcWalletProvider: "fireblocks",
      status: "ready",
      providerRef: address.providerRef,
    }
  } catch (error) {
    return {
      btcAddress: null,
      btcAddressType: "unknown",
      btcWalletProvider: "fireblocks",
      status: "provider_failed",
      error: safeProviderError(error),
    }
  }
}
