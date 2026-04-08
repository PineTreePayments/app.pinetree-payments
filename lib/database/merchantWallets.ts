import { supabase } from "./supabase"

export type MerchantWallet = {
  id: string
  merchant_id: string
  network: string
  address: string
  priority: number
  status: "connected" | "disconnected"
  created_at: string
  updated_at: string
}

/**
 * Get all connected wallets for a merchant
 * Ordered by priority (highest first)
 */
export async function getMerchantWallets(merchantId: string) {
  const { data, error } = await supabase
    .from("merchant_wallets")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("status", "connected")
    .order("priority", { ascending: false })

  if (error) {
    return []
  }

  return data as MerchantWallet[]
}

/**
 * Get best available wallet for a network
 */
export async function getBestWalletForNetwork(
  merchantId: string,
  network: string
) {
  const { data, error } = await supabase
    .from("merchant_wallets")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("network", network.toLowerCase())
    .eq("status", "connected")
    .order("priority", { ascending: false })
    .limit(1)
    .single()

  if (error) {
    return null
  }

  return data as MerchantWallet | null
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