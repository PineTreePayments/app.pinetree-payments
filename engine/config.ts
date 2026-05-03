import type { BaseUsdcStrategy } from "@/types/payment"

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

const BASE_NATIVE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const DEFAULT_BASE_USDC_AUTH_VALIDITY_SECONDS = 600
const MIN_BASE_USDC_AUTH_VALIDITY_SECONDS = 300
const MAX_BASE_USDC_AUTH_VALIDITY_SECONDS = 900
const DEFAULT_BASE_USDC_STRATEGY: BaseUsdcStrategy = "v1_approve_splitToken"

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

function requireEvmAddress(envName: string, value: string): string {
  const normalized = String(value || "").trim()

  if (!normalized) {
    throw new Error(`Missing required environment variable: ${envName}`)
  }

  if (!isEvmAddress(normalized)) {
    throw new Error(`Invalid ${envName}. Expected a valid 0x EVM address.`)
  }

  return normalized
}

function isPrivateKey(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim())
}

function getEvmSplitMode(): string {
  return String(process.env.PINETREE_EVM_SPLIT_MODE || "").toLowerCase().trim()
}

function getEvmSplitContract(network: "base" | "ethereum"): string {
  if (network === "ethereum") {
    return String(process.env.PINETREE_EVM_SPLIT_CONTRACT_ETHEREUM || "").trim()
  }

  return String(process.env.PINETREE_EVM_SPLIT_CONTRACT_BASE || "").trim()
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
 * Enforce runtime config required for successful split processing by rail.
 *
 * - Solana: treasury wallet format must be valid.
 * - EVM contract_split mode: requires PINETREE_EVM_SPLIT_MODE=contract + valid split contract.
 * - EVM direct mode (default): no contract required — direct ETH to merchant wallet.
 */
export function assertSplitRailConfig(network: string): void {
  const normalized = normalizeTreasuryNetwork(network)

  // Always validate treasury format first
  assertTreasuryWalletFormat(normalized)

  if (normalized === "solana") {
    return
  }

  // Only require split contract when contract_split mode is explicitly enabled
  const splitMode = getEvmSplitMode()
  if (splitMode === "contract") {
    const splitContract = getEvmSplitContract(normalized)
    if (!isEvmAddress(splitContract)) {
      throw new Error(
        `Missing or invalid EVM split contract for ${normalized}. Configure ${
          normalized === "ethereum"
            ? "PINETREE_EVM_SPLIT_CONTRACT_ETHEREUM"
            : "PINETREE_EVM_SPLIT_CONTRACT_BASE"
        } with a valid 0x address.`
      )
    }
  }
  // Direct mode (PINETREE_EVM_SPLIT_MODE not set or "direct"): no contract required
}

/**
 * Base USDC V4 relayer configuration
 *
 * These helpers are server-side engine configuration only. In particular,
 * PINETREE_BASE_USDC_RELAYER_PRIVATE_KEY must never be exposed to browser code
 * or any NEXT_PUBLIC_* environment variable.
 */
export function getBaseUsdcV4Contract(): string {
  return requireEvmAddress(
    "PINETREE_BASE_USDC_V4_CONTRACT",
    process.env.PINETREE_BASE_USDC_V4_CONTRACT || ""
  )
}

export function getBaseUsdcTokenAddress(): string {
  const tokenAddress = requireEvmAddress(
    "PINETREE_BASE_USDC_TOKEN_ADDRESS",
    process.env.PINETREE_BASE_USDC_TOKEN_ADDRESS || BASE_NATIVE_USDC_ADDRESS
  )

  if (tokenAddress.toLowerCase() !== BASE_NATIVE_USDC_ADDRESS.toLowerCase()) {
    throw new Error(
      "Invalid PINETREE_BASE_USDC_TOKEN_ADDRESS. Base USDC V4 requires native Base USDC " +
        `${BASE_NATIVE_USDC_ADDRESS}.`
    )
  }

  return tokenAddress
}

export function getBaseUsdcRelayer(): { address: string; privateKey: string } {
  const address = requireEvmAddress(
    "PINETREE_BASE_USDC_RELAYER_ADDRESS",
    process.env.PINETREE_BASE_USDC_RELAYER_ADDRESS || ""
  )
  const privateKey = String(process.env.PINETREE_BASE_USDC_RELAYER_PRIVATE_KEY || "").trim()

  if (!privateKey) {
    throw new Error("Missing required environment variable: PINETREE_BASE_USDC_RELAYER_PRIVATE_KEY")
  }

  if (!isPrivateKey(privateKey)) {
    throw new Error(
      "Invalid PINETREE_BASE_USDC_RELAYER_PRIVATE_KEY. Expected a 0x-prefixed 32-byte private key."
    )
  }

  return { address, privateKey }
}

export function getBaseUsdcGasCap(): { maxGasUsd: number } {
  const raw = String(process.env.PINETREE_BASE_USDC_MAX_GAS_USD || "").trim()

  if (!raw) {
    throw new Error("Missing required environment variable: PINETREE_BASE_USDC_MAX_GAS_USD")
  }

  const maxGasUsd = Number(raw)

  if (!Number.isFinite(maxGasUsd) || maxGasUsd <= 0) {
    throw new Error("Invalid PINETREE_BASE_USDC_MAX_GAS_USD. Expected a finite number greater than 0.")
  }

  return { maxGasUsd }
}

export function getBaseUsdcAuthValiditySeconds(): number {
  const raw = String(process.env.PINETREE_BASE_USDC_AUTH_VALIDITY_SECONDS || "").trim()
  const seconds = raw ? Number(raw) : DEFAULT_BASE_USDC_AUTH_VALIDITY_SECONDS

  if (
    !Number.isFinite(seconds) ||
    seconds < MIN_BASE_USDC_AUTH_VALIDITY_SECONDS ||
    seconds > MAX_BASE_USDC_AUTH_VALIDITY_SECONDS
  ) {
    throw new Error(
      "Invalid PINETREE_BASE_USDC_AUTH_VALIDITY_SECONDS. Expected a finite number between " +
        `${MIN_BASE_USDC_AUTH_VALIDITY_SECONDS} and ${MAX_BASE_USDC_AUTH_VALIDITY_SECONDS}.`
    )
  }

  return Math.floor(seconds)
}

export function assertBaseUsdcV4Config(): void {
  getBaseUsdcV4Contract()
  getBaseUsdcTokenAddress()
  getBaseUsdcRelayer()
  getBaseUsdcGasCap()
  getBaseUsdcAuthValiditySeconds()

  requireEvmAddress(
    "PINETREE_TREASURY_WALLET_BASE",
    process.env.PINETREE_TREASURY_WALLET_BASE || ""
  )
}

export function isBaseUsdcV4Configured(): boolean {
  try {
    assertBaseUsdcV4Config()
    return true
  } catch {
    return false
  }
}

export function getBaseUsdcStrategy(): BaseUsdcStrategy {
  const strategy = String(
    process.env.PINETREE_BASE_USDC_STRATEGY || DEFAULT_BASE_USDC_STRATEGY
  ).trim()

  if (strategy === "v1_approve_splitToken" || strategy === "v4_eip3009_relayer") {
    return strategy
  }

  throw new Error(
    "Invalid PINETREE_BASE_USDC_STRATEGY. Expected v1_approve_splitToken or v4_eip3009_relayer."
  )
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
  // Check both naming conventions — Vercel may have either RPC_URL_SOLANA or SOLANA_RPC_URL
  solana:
    process.env.RPC_URL_SOLANA ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com",
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
 * Auto polling master switch (default OFF)
 *
 * - Server-side watcher loops
 * - Any periodic polling tied to payment lifecycle
 *
 * Set PINETREE_ENABLE_AUTO_POLLING=true to re-enable.
 */
export const AUTO_POLLING_ENABLED =
  String(process.env.PINETREE_ENABLE_AUTO_POLLING || "").toLowerCase().trim() === "true"

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