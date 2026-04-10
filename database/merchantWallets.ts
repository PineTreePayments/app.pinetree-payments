import { supabase } from "./supabase"

export type MerchantWallet = {
  id: string
  merchant_id: string
  network: string
  wallet_address: string
  asset: string
  is_primary?: boolean
  status?: string | null
  wallet_type?: string | null
  created_at: string
}

function providerToNetworks(provider: string): string[] {
  const value = String(provider || "").toLowerCase().trim()
  if (value === "solana") return ["solana"]
  if (value === "coinbase" || value === "base") return ["base"]
  if (value === "shift4") return ["ethereum"]
  return []
}

async function getAuthoritativeConnectedNetworks(merchantId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("merchant_providers")
    .select("provider,status,enabled")
    .eq("merchant_id", merchantId)
    .eq("enabled", true)
    .in("status", ["connected", "active"])

  if (error || !data) {
    return new Set<string>()
  }

  const networks = new Set<string>()
  for (const row of data as Array<{ provider?: string | null }>) {
    for (const n of providerToNetworks(String(row.provider || ""))) {
      networks.add(n)
    }
  }

  return networks
}

/**
 * Get all connected wallets for a merchant
 * Ordered by priority (highest first)
 */
export async function getMerchantWallets(merchantId: string) {
  const connectedNetworks = await getAuthoritativeConnectedNetworks(merchantId)
  if (connectedNetworks.size === 0) {
    return []
  }

  const { data, error } = await supabase
    .from("merchant_wallets")
    .select("*")
    .eq("merchant_id", merchantId)
    .not("wallet_address", "is", null)

  if (error || !data) {
    return []
  }

  const wallets = (data as MerchantWallet[])
    .filter((wallet) => {
      const network = String(wallet.network || "").toLowerCase().trim()
      const address = String(wallet.wallet_address || "").trim()
      return Boolean(address) && connectedNetworks.has(network)
    })
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))

  return wallets
}

/**
 * Get best available wallet for a network
 */
export async function getBestWalletForNetwork(
  merchantId: string,
  network: string
) {
  const wallets = await getMerchantWallets(merchantId)
  const target = network.toLowerCase()
  return wallets.find((wallet) => String(wallet.network || "").toLowerCase() === target) || null
}

/**
 * Get default wallet for a merchant
 * Uses highest priority wallet
 */
export async function getDefaultWallet(merchantId: string) {
  const wallets = await getMerchantWallets(merchantId)
  return wallets[0] || null
}

/**
 * Check if merchant has any wallet connected
 */
export async function hasAnyWalletConnected(merchantId: string) {
  const wallets = await getMerchantWallets(merchantId)
  return wallets.length > 0
}

/**
 * Check if merchant has wallet for a specific network
 */
export async function hasWalletForNetwork(
  merchantId: string,
  network: string
) {
  const wallet = await getBestWalletForNetwork(merchantId, network)
  return wallet !== null
}

/**
 * Smart routing - select best available wallet
 */
export async function selectBestWallet(
  merchantId: string,
  preferredNetwork?: string
) {
  // If specific network requested, try to use it
  if (preferredNetwork) {
    const wallet = await getBestWalletForNetwork(merchantId, preferredNetwork)
    if (wallet) {
      return wallet
    }
  }

  // Fallback to highest priority wallet
  return getDefaultWallet(merchantId)
}