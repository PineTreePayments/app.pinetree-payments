import { FLUIDPAY_API_CONTRACT_VERIFIED } from "./fluidpay/constants"

export type MerchantProviderReadinessRow = {
  provider?: string | null
  status?: string | null
  enabled?: boolean | null
  credentials?: unknown
}

function credentialsOf(provider: MerchantProviderReadinessRow): Record<string, unknown> {
  return provider.credentials && typeof provider.credentials === "object"
    ? provider.credentials as Record<string, unknown>
    : {}
}

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

export function isStripeConnectSetupReady(provider: MerchantProviderReadinessRow): boolean {
  if (normalized(provider.provider) !== "stripe") return false

  const credentials = credentialsOf(provider)
  return (
    normalized(provider.status) === "active" &&
    credentials.charges_enabled === true &&
    Boolean(String(credentials.stripe_account_id || "").trim())
  )
}

export function isStripeConnectReady(provider: MerchantProviderReadinessRow): boolean {
  return provider.enabled === true && isStripeConnectSetupReady(provider)
}

export function isLegacyCardProviderSetupReady(provider: MerchantProviderReadinessRow): boolean {
  const providerId = normalized(provider.provider)
  if (providerId !== "shift4" && providerId !== "fluidpay") return false

  const credentials = credentialsOf(provider)
  const applicationStatus = normalized(credentials.application_status)
  const providerStatus = normalized(provider.status)
  if (providerId === "fluidpay") {
    return FLUIDPAY_API_CONTRACT_VERIFIED && applicationStatus === "approved"
  }
  return (
    applicationStatus === "approved" ||
    providerStatus === "active" ||
    providerStatus === "connected"
  )
}

export function isLegacyCardProviderApproved(provider: MerchantProviderReadinessRow): boolean {
  return provider.enabled !== false && isLegacyCardProviderSetupReady(provider)
}

export function isCardProviderSetupReady(provider: MerchantProviderReadinessRow): boolean {
  const providerId = normalized(provider.provider)
  if (providerId === "stripe") return isStripeConnectSetupReady(provider)
  if (providerId === "shift4" || providerId === "fluidpay") {
    return isLegacyCardProviderSetupReady(provider)
  }
  return false
}

export function canCardProviderProcessPayments(provider: MerchantProviderReadinessRow): boolean {
  return provider.enabled !== false && isCardProviderSetupReady(provider)
}

export function merchantProviderCanProcessPayments(provider: MerchantProviderReadinessRow): boolean {
  const providerId = normalized(provider.provider)
  if (providerId === "stripe" || providerId === "shift4" || providerId === "fluidpay") {
    return canCardProviderProcessPayments(provider)
  }
  return provider.enabled !== false
}
