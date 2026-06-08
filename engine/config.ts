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

  if (normalized === "base") {
    assertBaseV7Config()
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

// ─── Base V7 config ───────────────────────────────────────────────────────────

export function getBaseV7Contract(): string {
  return requireEvmAddress(
    "PINETREE_BASE_V7_CONTRACT",
    process.env.PINETREE_BASE_V7_CONTRACT || ""
  )
}

export function getBaseV7UsdcToken(): string {
  const tokenAddress = requireEvmAddress(
    "PINETREE_BASE_V7_USDC_TOKEN",
    process.env.PINETREE_BASE_V7_USDC_TOKEN || BASE_NATIVE_USDC_ADDRESS
  )
  if (tokenAddress.toLowerCase() !== BASE_NATIVE_USDC_ADDRESS.toLowerCase()) {
    throw new Error(
      "Invalid PINETREE_BASE_V7_USDC_TOKEN. Base V7 requires native Base USDC " +
        `${BASE_NATIVE_USDC_ADDRESS}.`
    )
  }
  return tokenAddress
}

export function getBaseV7Relayer(): { address: string; privateKey: string } {
  const address = requireEvmAddress(
    "PINETREE_BASE_V7_RELAYER_ADDRESS",
    process.env.PINETREE_BASE_V7_RELAYER_ADDRESS || ""
  )
  const privateKey = String(process.env.PINETREE_BASE_V7_RELAYER_PRIVATE_KEY || "").trim()

  if (!privateKey) {
    throw new Error("Missing required environment variable: PINETREE_BASE_V7_RELAYER_PRIVATE_KEY")
  }
  if (!isPrivateKey(privateKey)) {
    throw new Error(
      "Invalid PINETREE_BASE_V7_RELAYER_PRIVATE_KEY. Expected a 0x-prefixed 32-byte private key."
    )
  }
  return { address, privateKey }
}

export function getBaseV7GasCap(): { maxGasUsd: number } {
  const raw = String(process.env.PINETREE_BASE_V7_MAX_GAS_USD || "").trim()
  if (!raw) {
    throw new Error("Missing required environment variable: PINETREE_BASE_V7_MAX_GAS_USD")
  }
  const maxGasUsd = Number(raw)
  if (!Number.isFinite(maxGasUsd) || maxGasUsd <= 0) {
    throw new Error("Invalid PINETREE_BASE_V7_MAX_GAS_USD. Expected a finite number greater than 0.")
  }
  return { maxGasUsd }
}

export function getBaseV7AuthValiditySeconds(): number {
  const raw = String(process.env.PINETREE_BASE_V7_AUTH_VALIDITY_SECONDS || "").trim()
  const seconds = raw ? Number(raw) : DEFAULT_BASE_USDC_AUTH_VALIDITY_SECONDS

  if (
    !Number.isFinite(seconds) ||
    seconds < MIN_BASE_USDC_AUTH_VALIDITY_SECONDS ||
    seconds > MAX_BASE_USDC_AUTH_VALIDITY_SECONDS
  ) {
    throw new Error(
      "Invalid PINETREE_BASE_V7_AUTH_VALIDITY_SECONDS. Expected a finite number between " +
        `${MIN_BASE_USDC_AUTH_VALIDITY_SECONDS} and ${MAX_BASE_USDC_AUTH_VALIDITY_SECONDS}.`
    )
  }
  return Math.floor(seconds)
}

export function isBaseV7DelegatedEnabled(): boolean {
  return String(process.env.PINETREE_BASE_V7_DELEGATED_ENABLED || "")
    .toLowerCase()
    .trim() === "true"
}

export function isBaseV7Eip3009Enabled(): boolean {
  const raw = String(process.env.PINETREE_BASE_V7_EIP3009_ENABLED || "").toLowerCase().trim()
  // Default true — opt-out by setting to "false"
  return raw !== "false"
}

export function assertBaseV7Config(): void {
  getBaseV7Contract()
  getBaseV7UsdcToken()
  getBaseV7Relayer()
  getBaseV7GasCap()
  getBaseV7AuthValiditySeconds()

  requireEvmAddress(
    "PINETREE_TREASURY_WALLET_BASE",
    process.env.PINETREE_TREASURY_WALLET_BASE || ""
  )
}

export function isBaseV7Configured(): boolean {
  try {
    assertBaseV7Config()
    return true
  } catch {
    return false
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
 * Network to return path mapping.
 * Solana Pay uses /solana-return for deeplink callbacks.
 * Base V7 (WalletConnect) does not use a return redirect; the legacy
 * /base-return page has been removed.
 */
export const NETWORK_RETURN_PATHS: Record<string, string> = {
  solana: "/solana-return",
}

/**
 * Get return path for a network
 */
export function getReturnPath(network: string): string {
  return NETWORK_RETURN_PATHS[network] || "/"
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
 * Checkout abandonment timeout.
 * A CREATED/PENDING payment with no provider evidence older than this threshold
 * is eligible to be marked INCOMPLETE by the stale sweep or admin backfill.
 * Must be kept in sync with the minimum timeout enforced by paymentStateActions.
 */
export const CHECKOUT_TIMEOUT_MS = 5 * 60 * 1_000 // 5 minutes

/**
 * Default payment expiration time
 */
export const PAYMENT_EXPIRATION_MINUTES = 30

/**
 * Validate that required configuration is present.
 *
 * Always checked (dev + production):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Production-only (NODE_ENV === "production"):
 *   CHECKOUT_SESSION_SECRET — HMAC key for checkout session tokens
 *   TERMINAL_SESSION_SECRET — HMAC key for POS terminal session tokens
 *   SPEED_WEBHOOK_SECRET    — Lightning webhook signature verification
 *
 * Rationale for production-only: local dev commonly runs without these vars
 * and fails gracefully when the code path is hit.  In production a missing
 * secret is a silent security hole, so we fail closed at startup.
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

  // Production-only checks — fail closed so a misconfigured deploy is caught
  // at first payment creation rather than silently falling back to no auth.
  if (process.env.NODE_ENV === "production") {
    const prodMissing: string[] = []

    if (!String(process.env.CHECKOUT_SESSION_SECRET || "").trim()) {
      prodMissing.push("CHECKOUT_SESSION_SECRET")
    }
    if (!String(process.env.TERMINAL_SESSION_SECRET || "").trim()) {
      prodMissing.push("TERMINAL_SESSION_SECRET")
    }
    if (!String(process.env.SPEED_WEBHOOK_SECRET || "").trim()) {
      prodMissing.push("SPEED_WEBHOOK_SECRET")
    }

    if (prodMissing.length > 0) {
      throw new Error(
        `Missing required production environment variables: ${prodMissing.join(", ")}. ` +
        "These must be set before processing payments."
      )
    }
  } else {
    // In dev/test: warn (do not throw) so local development still works
    // without a full secrets setup.
    const devWarn: string[] = []
    if (!String(process.env.CHECKOUT_SESSION_SECRET || "").trim()) devWarn.push("CHECKOUT_SESSION_SECRET")
    if (!String(process.env.TERMINAL_SESSION_SECRET || "").trim()) devWarn.push("TERMINAL_SESSION_SECRET")
    if (!String(process.env.SPEED_WEBHOOK_SECRET    || "").trim()) devWarn.push("SPEED_WEBHOOK_SECRET")

    if (devWarn.length > 0) {
      console.warn(
        `[config] WARNING: Missing environment variables in dev: ${devWarn.join(", ")}. ` +
        "These are required in production. Token signing or webhook verification will fail if these code paths are exercised."
      )
    }
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