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

export function isStripeConnectReady(provider: MerchantProviderReadinessRow): boolean {
  if (normalized(provider.provider) !== "stripe") return false

  const credentials = credentialsOf(provider)
  return (
    normalized(provider.status) === "active" &&
    provider.enabled === true &&
    credentials.charges_enabled === true &&
    Boolean(String(credentials.stripe_account_id || "").trim())
  )
}

export function isLegacyCardProviderApproved(provider: MerchantProviderReadinessRow): boolean {
  const providerId = normalized(provider.provider)
  if (providerId !== "shift4" && providerId !== "fluidpay") return false
  if (provider.enabled === false) return false

  const credentials = credentialsOf(provider)
  const applicationStatus = normalized(credentials.application_status)
  const providerStatus = normalized(provider.status)
  if (providerId === "fluidpay") return applicationStatus === "approved"
  return (
    applicationStatus === "approved" ||
    providerStatus === "active" ||
    providerStatus === "connected"
  )
}

export function canCardProviderProcessPayments(provider: MerchantProviderReadinessRow): boolean {
  const providerId = normalized(provider.provider)
  if (providerId === "stripe") return isStripeConnectReady(provider)
  if (providerId === "shift4" || providerId === "fluidpay") {
    return isLegacyCardProviderApproved(provider)
  }
  return false
}

export function merchantProviderCanProcessPayments(provider: MerchantProviderReadinessRow): boolean {
  const providerId = normalized(provider.provider)
  if (providerId === "stripe" || providerId === "shift4" || providerId === "fluidpay") {
    return canCardProviderProcessPayments(provider)
  }
  return provider.enabled !== false
}
