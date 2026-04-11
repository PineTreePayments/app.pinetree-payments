/**
 * PineTree Engine Configuration
 * 
 * Centralized configuration for the PineTree payment engine.
 * All system constants and platform settings are defined here.
 */

/**
 * PineTree Platform Fee
 * The standard fee charged per transaction
 */
export const PINETREE_FEE = 0.15

/**
 * PineTree Treasury Wallet
 * Wallet address where platform fees are collected
 */
export const PINETREE_TREASURY_WALLET = 
  process.env.PINETREE_TREASURY_WALLET || ""

const DEFAULT_PINETREE_TREASURY_WALLETS = {
  solana: "CXqPwfvDJ5HYBEwBC9id9oGH9hsf4gShywBN3WzDL5Aw",
  base: "0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903",
  ethereum: "0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903"
} as const

/**
 * Network-specific PineTree treasury wallets
 *
 * Notes:
 * - Solana uses its own address format
 * - Base/Ethereum are EVM and can share the same 0x address
 */
export const PINETREE_TREASURY_WALLETS = {
  solana:
    process.env.PINETREE_TREASURY_WALLET_SOLANA ||
    process.env.PINETREE_TREASURY_WALLET ||
    DEFAULT_PINETREE_TREASURY_WALLETS.solana,
  base:
    process.env.PINETREE_TREASURY_WALLET_BASE ||
    process.env.PINETREE_TREASURY_WALLET ||
    DEFAULT_PINETREE_TREASURY_WALLETS.base,
  ethereum:
    process.env.PINETREE_TREASURY_WALLET_ETHEREUM ||
    process.env.PINETREE_TREASURY_WALLET_BASE ||
    process.env.PINETREE_TREASURY_WALLET ||
    DEFAULT_PINETREE_TREASURY_WALLETS.ethereum
} as const

const TREASURY_WALLET_SOURCES = {
  solana: process.env.PINETREE_TREASURY_WALLET_SOLANA
    ? "PINETREE_TREASURY_WALLET_SOLANA"
    : process.env.PINETREE_TREASURY_WALLET
      ? "PINETREE_TREASURY_WALLET"
      : "DEFAULT",
  base: process.env.PINETREE_TREASURY_WALLET_BASE
    ? "PINETREE_TREASURY_WALLET_BASE"
    : process.env.PINETREE_TREASURY_WALLET
      ? "PINETREE_TREASURY_WALLET"
      : "DEFAULT",
  ethereum: process.env.PINETREE_TREASURY_WALLET_ETHEREUM
    ? "PINETREE_TREASURY_WALLET_ETHEREUM"
    : process.env.PINETREE_TREASURY_WALLET_BASE
      ? "PINETREE_TREASURY_WALLET_BASE"
      : process.env.PINETREE_TREASURY_WALLET
        ? "PINETREE_TREASURY_WALLET"
        : "DEFAULT"
} as const

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim())
}

function isLikelySolanaAddress(value: string): boolean {
  // Base58-ish, common Solana length range
  const normalized = String(value || "").trim()
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalized)
}

function normalizeTreasuryNetwork(network: string): "solana" | "base" | "ethereum" {
  const value = String(network || "").toLowerCase().trim()
  if (value === "solana") return "solana"
  if (value === "base" || value === "base_pay") return "base"
  if (value === "ethereum") return "ethereum"
  throw new Error(`Unsupported treasury network: ${network}`)
}

export function getPineTreeTreasuryWallet(network: string): string {
  const normalized = normalizeTreasuryNetwork(network)
  const wallet = String(PINETREE_TREASURY_WALLETS[normalized] || "").trim()

  if (wallet) return wallet
  if (PINETREE_TREASURY_WALLET) return PINETREE_TREASURY_WALLET

  throw new Error(
    `Missing PineTree treasury wallet for network: ${normalized}. Configure PINETREE_TREASURY_WALLET_${normalized.toUpperCase()}.`
  )
}

export function assertTreasuryWalletFormat(network: string): void {
  const normalized = normalizeTreasuryNetwork(network)
  const wallet = getPineTreeTreasuryWallet(normalized)

  if (normalized === "solana") {
    if (!isLikelySolanaAddress(wallet)) {
      throw new Error(
        "Invalid PINETREE treasury wallet format for Solana. Expected a valid Solana address in PINETREE_TREASURY_WALLET_SOLANA."
      )
    }
    return
  }

  if (!isEvmAddress(wallet)) {
    throw new Error(
      `Invalid PINETREE treasury wallet format for ${normalized}. Expected 0x... EVM address in PINETREE_TREASURY_WALLET_${normalized.toUpperCase()}.`
    )
  }
}

/**
 * Base Application URL
 */
export const BASE_URL = 
  process.env.NEXT_PUBLIC_APP_URL || 
  "https://app.pinetree-payments.com"

/**
 * RPC URLs for different networks
 */
export const RPC_URLS: Record<string, string> = {
  solana: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  base: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  ethereum: process.env.ETH_RPC_URL || "https://cloudflare-eth.com",
  polygon: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com"
}

/**
 * Network to return path mapping
 * Determines which return page to use after payment
 */
export const NETWORK_RETURN_PATHS: Record<string, string> = {
  base: "/base-return",
  base_pay: "/base-return",
  ethereum: "/base-return",
  solana: "/solana-return",
  coinbase: "/coinbase-return"
}

/**
 * Get return path for a network
 */
export function getReturnPath(network: string): string {
  return NETWORK_RETURN_PATHS[network] || "/base-return"
}

/**
 * Get RPC URL for a network
 */
export function getRpcUrl(network: string): string {
  const url = RPC_URLS[network]
  
  if (!url) {
    throw new Error(`No RPC URL configured for network: ${network}`)
  }
  
  return url
}

/**
 * Payment watcher configuration
 */
export const WATCHER_CONFIG = {
  pollInterval: 4000,  // 4 seconds
  maxAttempts: 300,    // 20 minutes total
  confirmationBlocks: 12  // Number of confirmations needed
}

/**
 * Provider health check configuration
 */
export const HEALTH_CHECK_CONFIG = {
  checkInterval: 30000,  // 30 seconds
  timeout: 5000,         // 5 second timeout
  maxFailures: 3         // Mark unhealthy after 3 failures
}

/**
 * Default payment expiration time
 */
export const PAYMENT_EXPIRATION_MINUTES = 30

/**
 * Validate that required configuration is present
 */
export function validateConfig(): void {
  const missing: string[] = []
  
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL")
  }
  
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  }

  // Treasury wallets are always resolved (env override -> shared env -> built-in defaults)
  // Format is verified separately by assertTreasuryWalletFormat in payment creation flow.
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    )
  }
}

let configValidated = false
let treasuryFallbackWarningLogged = false

function logTreasuryFallbackWarningsOnce(): void {
  if (treasuryFallbackWarningLogged) return

  const fallbackNetworks = Object.entries(TREASURY_WALLET_SOURCES)
    .filter(([, source]) => source === "DEFAULT")
    .map(([network]) => network)

  if (fallbackNetworks.length > 0) {
    console.warn(
      `[config] Using built-in PineTree treasury wallet defaults for networks: ${fallbackNetworks.join(", ")}. ` +
      "Set PINETREE_TREASURY_WALLET_SOLANA / PINETREE_TREASURY_WALLET_BASE / PINETREE_TREASURY_WALLET_ETHEREUM in production to override."
    )
  }

  treasuryFallbackWarningLogged = true
}

export function validateConfigOnce(): void {
  if (configValidated) return
  validateConfig()
  logTreasuryFallbackWarningsOnce()
  configValidated = true
}