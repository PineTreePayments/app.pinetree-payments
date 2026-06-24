import {
  inferBtcAddressType,
  type BtcAddressType,
} from "@/database/pineTreeWalletProfiles"

export type FireblocksBitcoinAddressResult = {
  btcAddress: string
  btcAddressType: BtcAddressType
  providerRef: string | null
}

export function isFireblocksBitcoinWalletConfigured(): boolean {
  return (
    process.env.PINE_TREE_BTC_WALLET_PROVIDER === "fireblocks" &&
    Boolean(String(process.env.FIREBLOCKS_API_KEY || "").trim()) &&
    Boolean(String(process.env.FIREBLOCKS_API_SECRET || "").trim()) &&
    Boolean(String(process.env.FIREBLOCKS_BASE_URL || "").trim())
  )
}

export async function getOrCreateMerchantBitcoinAddress(
  merchantId: string
): Promise<FireblocksBitcoinAddressResult> {
  if (!isFireblocksBitcoinWalletConfigured()) {
    throw new Error("Fireblocks Bitcoin wallet provider is not configured")
  }

  // TODO: Implement Fireblocks idempotent vault/account/address lookup here.
  // Endpoint constants will live in this adapter so wallet UI and profile sync
  // do not need to change when Fireblocks provisioning is completed.
  const testAddress = String(process.env.FIREBLOCKS_TEST_BTC_ADDRESS || "").trim()
  if (!testAddress) {
    throw new Error("Fireblocks Bitcoin address provisioning adapter is not implemented")
  }

  return {
    btcAddress: testAddress,
    btcAddressType: inferBtcAddressType(testAddress),
    providerRef: `fireblocks:${merchantId}`,
  }
}

