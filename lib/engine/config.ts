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
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    )
  }
}