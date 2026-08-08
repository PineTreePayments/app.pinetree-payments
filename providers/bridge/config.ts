/**
 * Bridge (by Stripe) - server-only configuration.
 *
 * SCOPE: Bridge is owned by Stripe but is NOT the Stripe SDK and NOT Stripe
 * Connect. It is a separate REST API (api.bridge.xyz) with its own API key,
 * its own customer objects, its own KYC/KYB, its own endorsements, and its own
 * webhook signing. Nothing in this directory may import the Stripe SDK, read a
 * Stripe environment variable, or infer Bridge eligibility from a Stripe
 * connected account. A merchant approved by Stripe Connect is NOT approved by
 * Bridge.
 *
 * Documented environment URLs:
 *   Sandbox:    https://api.sandbox.bridge.xyz/v0
 *   Production: https://api.bridge.xyz/v0
 *
 * SECURITY: server-only. No value here may be read through NEXT_PUBLIC_*, and
 * no credential is ever hardcoded, defaulted, or logged.
 */

export const BRIDGE_SANDBOX_BASE_URL = "https://api.sandbox.bridge.xyz/v0"
export const BRIDGE_PRODUCTION_BASE_URL = "https://api.bridge.xyz/v0"

export type BridgeEnvironment = "sandbox" | "production"

export type BridgeConfig = {
  environment: BridgeEnvironment
  baseUrl: string
  apiKey: string
  kycRedirectUrl: string
}

export class BridgeConfigError extends Error {
  readonly missing: string[]

  constructor(message: string, missing: string[] = []) {
    super(message)
    this.name = "BridgeConfigError"
    this.missing = missing
  }
}

function readEnv(name: string): string {
  return String(process.env[name] || "").trim()
}

/**
 * Resolve the Bridge environment.
 *
 * There is deliberately NO default. An unset or unrecognized value fails
 * closed rather than aiming live merchant onboarding at the wrong Bridge
 * developer account.
 */
export function resolveBridgeEnvironment(raw?: string): BridgeEnvironment {
  const value = String(raw ?? readEnv("BRIDGE_ENVIRONMENT")).trim().toLowerCase()
  if (value === "sandbox" || value === "test") return "sandbox"
  if (value === "production" || value === "live") return "production"
  throw new BridgeConfigError(
    'BRIDGE_ENVIRONMENT must be exactly "sandbox" or "production".',
    ["BRIDGE_ENVIRONMENT"]
  )
}

export function bridgeBaseUrlForEnvironment(environment: BridgeEnvironment): string {
  return environment === "production" ? BRIDGE_PRODUCTION_BASE_URL : BRIDGE_SANDBOX_BASE_URL
}

/**
 * True when a base URL host clearly belongs to the Bridge sandbox.
 *
 * Used only to REJECT a cross-environment configuration. It never selects an
 * environment on its own - the environment is always explicit.
 */
function looksLikeSandboxHost(host: string): boolean {
  return host === "api.sandbox.bridge.xyz" || host.startsWith("sandbox.") || host.includes(".sandbox.")
}

/**
 * Validate an explicit BRIDGE_BASE_URL override.
 *
 * The override exists so a Bridge-issued alternate host can be configured
 * without a code change, but it may never silently cross environments: a
 * production deployment pointed at a sandbox host (or the reverse) is a
 * configuration error, not a fallback.
 */
export function validateBridgeBaseUrl(raw: string, environment: BridgeEnvironment): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new BridgeConfigError("BRIDGE_BASE_URL is not a valid absolute URL.", ["BRIDGE_BASE_URL"])
  }

  if (parsed.protocol !== "https:") {
    throw new BridgeConfigError("BRIDGE_BASE_URL must use https.", ["BRIDGE_BASE_URL"])
  }

  const sandboxHost = looksLikeSandboxHost(parsed.host)
  if (environment === "production" && sandboxHost) {
    throw new BridgeConfigError(
      "BRIDGE_BASE_URL points at a Bridge sandbox host while BRIDGE_ENVIRONMENT is production.",
      ["BRIDGE_BASE_URL"]
    )
  }
  if (environment === "sandbox" && !sandboxHost) {
    throw new BridgeConfigError(
      "BRIDGE_BASE_URL does not point at a Bridge sandbox host while BRIDGE_ENVIRONMENT is sandbox.",
      ["BRIDGE_BASE_URL"]
    )
  }

  // Trailing slashes would produce "//v0/kyc_links" once a path is appended.
  return raw.replace(/\/+$/, "")
}

function validateKycRedirectUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new BridgeConfigError(
      "BRIDGE_KYC_REDIRECT_URL is not a valid absolute URL.",
      ["BRIDGE_KYC_REDIRECT_URL"]
    )
  }
  // The redirect only returns the merchant's browser to PineTree. It is never
  // proof of approval, but it still must not be able to send a merchant to an
  // unencrypted or attacker-chosen destination.
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new BridgeConfigError(
      "BRIDGE_KYC_REDIRECT_URL must use https (localhost is allowed for development).",
      ["BRIDGE_KYC_REDIRECT_URL"]
    )
  }
  return raw
}

/**
 * Shape check for the Bridge API key. The value is never included in the
 * error - only the fact that it is unusable.
 */
function assertUsableApiKey(value: string): void {
  if (value.length < 8) {
    throw new BridgeConfigError("BRIDGE_API_KEY is too short to be a Bridge API key.", ["BRIDGE_API_KEY"])
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x20 || codePoint === 0x7f) {
      throw new BridgeConfigError("BRIDGE_API_KEY contains whitespace or control characters.", ["BRIDGE_API_KEY"])
    }
  }
}

/**
 * Resolve and validate the Bridge configuration.
 *
 * Throws BridgeConfigError when the deployment is not configured, so a
 * misconfigured environment fails closed at the server boundary instead of
 * sending a request Bridge would reject - or worse, sending a production
 * merchant into a sandbox onboarding flow.
 */
export function getBridgeConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  if (overrides.baseUrl && !overrides.environment) {
    throw new BridgeConfigError(
      "A Bridge baseUrl override requires an explicit environment so sandbox and production cannot be confused."
    )
  }

  const environment = overrides.environment ?? resolveBridgeEnvironment()

  const missing: string[] = []
  const apiKey = overrides.apiKey ?? readEnv("BRIDGE_API_KEY")
  if (!apiKey) missing.push("BRIDGE_API_KEY")

  const kycRedirectUrl = overrides.kycRedirectUrl ?? readEnv("BRIDGE_KYC_REDIRECT_URL")
  if (!kycRedirectUrl) missing.push("BRIDGE_KYC_REDIRECT_URL")

  if (missing.length > 0) {
    throw new BridgeConfigError(
      `Bridge is not configured. Missing: ${missing.join(", ")}.`,
      missing
    )
  }

  assertUsableApiKey(apiKey)

  const rawBaseUrl = overrides.baseUrl ?? readEnv("BRIDGE_BASE_URL")
  const baseUrl = rawBaseUrl
    ? validateBridgeBaseUrl(rawBaseUrl, environment)
    : bridgeBaseUrlForEnvironment(environment)

  return {
    environment,
    baseUrl,
    apiKey,
    kycRedirectUrl: validateKycRedirectUrl(kycRedirectUrl),
  }
}

/**
 * The PEM public key Bridge publishes for a webhook endpoint, used to verify
 * `X-Webhook-Signature`. Deployment variables cannot carry real newlines, so
 * an escaped "\n" sequence is accepted and restored here.
 *
 * SECURITY: verification material never leaves the server and is never
 * returned to a browser or written to a database row.
 */
export function getBridgeWebhookPublicKey(raw?: string): string {
  const value = String(raw ?? readEnv("BRIDGE_WEBHOOK_PUBLIC_KEY"))
  const normalized = value.includes("\\n") ? value.replace(/\\n/g, "\n") : value
  const trimmed = normalized.trim()

  if (!trimmed) {
    throw new BridgeConfigError(
      "BRIDGE_WEBHOOK_PUBLIC_KEY is not configured. Bridge publishes a per-endpoint public key in the Bridge Dashboard.",
      ["BRIDGE_WEBHOOK_PUBLIC_KEY"]
    )
  }
  if (!trimmed.includes("-----BEGIN PUBLIC KEY-----") || !trimmed.includes("-----END PUBLIC KEY-----")) {
    throw new BridgeConfigError(
      "BRIDGE_WEBHOOK_PUBLIC_KEY must be a PEM-encoded public key (-----BEGIN PUBLIC KEY-----).",
      ["BRIDGE_WEBHOOK_PUBLIC_KEY"]
    )
  }
  return trimmed
}

/**
 * Non-secret configuration summary safe for diagnostics and admin surfaces.
 * Reports only whether credentials are present - never a value or a length.
 */
export function describeBridgeConfiguration(): {
  configured: boolean
  environment: BridgeEnvironment | null
  baseUrl: string | null
  apiKeyConfigured: boolean
  webhookPublicKeyConfigured: boolean
  kycRedirectUrlConfigured: boolean
  missing: string[]
} {
  const missing: string[] = []
  let environment: BridgeEnvironment | null = null
  let baseUrl: string | null = null
  let apiKeyConfigured = false
  let kycRedirectUrlConfigured = false

  try {
    const config = getBridgeConfig()
    environment = config.environment
    baseUrl = config.baseUrl
    apiKeyConfigured = true
    kycRedirectUrlConfigured = true
  } catch (error) {
    if (error instanceof BridgeConfigError) {
      missing.push(...(error.missing.length > 0 ? error.missing : ["BRIDGE_CONFIGURATION_INVALID"]))
    } else {
      throw error
    }
  }

  let webhookPublicKeyConfigured = false
  try {
    getBridgeWebhookPublicKey()
    webhookPublicKeyConfigured = true
  } catch {
    missing.push("BRIDGE_WEBHOOK_PUBLIC_KEY")
  }

  return {
    configured: missing.length === 0,
    environment,
    baseUrl,
    apiKeyConfigured,
    webhookPublicKeyConfigured,
    kycRedirectUrlConfigured,
    missing: Array.from(new Set(missing)),
  }
}

/** True when Bridge is configured well enough to attempt any provider call. */
export function isBridgeConfigured(): boolean {
  try {
    getBridgeConfig()
    return true
  } catch {
    return false
  }
}

/**
 * True only when this deployment is explicitly pointed at the Bridge sandbox.
 *
 * Every sandbox-only behavior - synthetic signed agreements and the simulated
 * KYB approval - is gated on this. It FAILS CLOSED: an unset or invalid
 * BRIDGE_ENVIRONMENT is not sandbox, so a misconfiguration can never unlock a
 * sandbox shortcut in production.
 */
export function isBridgeSandbox(): boolean {
  try {
    return getBridgeConfig().environment === "sandbox"
  } catch {
    return false
  }
}
