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

// Providers that store payment addresses in merchant_wallets.
// Non-wallet providers (e.g. lightning_nwc) must not influence which wallet rows
// are returned — they have no entry in merchant_wallets.
const WALLET_BASED_PROVIDERS = new Set(["solana", "base", "coinbase"])

async function getConnectedProviderNetworks(merchantId: string): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("merchant_providers")
    .select("provider,status")
    .eq("merchant_id", merchantId)
    .in("status", ["connected", "active"])

  if (error || !data || data.length === 0) {
    return null
  }

  const walletProviders = (data as Array<{ provider?: string | null }>).filter(
    (row) => WALLET_BASED_PROVIDERS.has(String(row.provider || "").toLowerCase().trim())
  )

  if (walletProviders.length === 0) {
    // No wallet-based providers configured — do not filter merchant_wallets
    return null
  }

  const networks = new Set<string>()
  for (const row of walletProviders) {
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

  // Maps provider key → the WalletNetwork it serves in hosted checkout.
  const hostedCheckoutProviders: Record<string, string> = {
    "shift4": "shift4",
    "lightning_speed": "bitcoin_lightning",
    "lightning_nwc": "bitcoin_lightning"
  }
  const networks: string[] = []

  for (const row of data as Array<{ provider?: string | null }>) {
    const provider = String(row.provider || "").toLowerCase().trim()
    const networkKey = hostedCheckoutProviders[provider]
    if (networkKey && !networks.includes(networkKey)) {
      networks.push(networkKey)
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
  if (preferredNetwork) {
    // Never fall back to a different-network wallet — caller must handle null
    return getBestWalletForNetwork(merchantId, preferredNetwork)
  }

  return getDefaultWallet(merchantId)
}
