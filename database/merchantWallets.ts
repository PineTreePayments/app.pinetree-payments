import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
import { getSupportedNetworksForAdapter } from "@/types/payment"

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
  return getSupportedNetworksForAdapter(provider)
}

async function getConnectedProviderNetworks(merchantId: string): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("merchant_providers")
    .select("provider,status")
    .eq("merchant_id", merchantId)
    .in("status", ["connected", "active"])

  if (error || !data || data.length === 0) {
    // No provider records — caller will use merchant_wallets directly
    return null
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
 * Get all connected wallets for a merchant.
 * If merchant_providers has entries, only wallets on those networks are returned.
 * If merchant_providers is empty (not yet set up), all wallets with an address are returned.
 */
export async function getMerchantWallets(merchantId: string) {
  const [connectedNetworks, walletsRes] = await Promise.all([
    getConnectedProviderNetworks(merchantId),
    supabase
      .from("merchant_wallets")
      .select("*")
      .eq("merchant_id", merchantId)
      .not("wallet_address", "is", null)
  ])

  if (walletsRes.error || !walletsRes.data) {
    return []
  }

  const allWallets = (walletsRes.data as MerchantWallet[]).filter(
    (w) => String(w.wallet_address || "").trim()
  )

  if (connectedNetworks === null) {
    // No provider configuration found — use wallets directly
    return allWallets.sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))
  }

  return allWallets
    .filter((wallet) => {
      const network = String(wallet.network || "").toLowerCase().trim()
      return connectedNetworks.has(network)
    })
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))
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
 * Returns networks served by hosted-checkout providers (e.g. shift4) that have
 * no entry in merchant_wallets. Used alongside getMerchantWallets to build the
 * full set of available payment options for a merchant.
 */
export async function getConnectedHostedCheckoutNetworks(merchantId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("merchant_providers")
    .select("provider,status")
    .eq("merchant_id", merchantId)
    .in("status", ["connected", "active"])

  if (error || !data || data.length === 0) return []

  const hostedCheckoutProviders = new Set(["shift4"])
  const networks: string[] = []

  for (const row of data as Array<{ provider?: string | null }>) {
    const provider = String(row.provider || "").toLowerCase().trim()
    if (hostedCheckoutProviders.has(provider)) {
      networks.push(provider)
    }
  }

  return networks
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