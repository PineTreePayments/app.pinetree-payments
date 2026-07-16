import { supabase, supabaseAdmin } from "@/database"
import {
  createStripeConnectedAccount,
  createStripeOnboardingLink,
  createStripeAccountSession,
  normalizeStripeAccountStatus,
  retrieveStripeConnectedAccount,
  retrieveStripeConnectedAccountDetails,
  STRIPE_MERCHANT_METADATA_KEY,
  StripeConnectionStatus,
  StripeNormalizedConnection
} from "@/providers/stripe"

// Resolve lazily so payment-event consumers do not need the Connect database
// surface unless they actually process a Stripe connected-account operation.
function getDb() {
  return supabaseAdmin || supabase
}

type StripeConnectCredentials = {
  stripe_account_id?: string
  details_submitted?: boolean
  charges_enabled?: boolean
  payouts_enabled?: boolean
  connect_last_synced_at?: string
  connect_onboarding_started_at?: string
  connection_status?: StripeConnectionStatus
  requirements_currently_due?: string[]
  requirements_eventually_due?: string[]
  requirements_past_due?: string[]
  requirements_pending_verification?: string[]
  disabled_reason?: string | null
  capabilities?: Record<string, string>
  provider_model?: string
  card_in_person_enabled?: boolean
  card_manual_entry_enabled?: boolean
  card_routing_preference?: string
}

/**
 * Safe, merchant-facing Stripe connection state. Never includes the Stripe
 * account ID, raw Stripe objects, secrets, or onboarding client secrets.
 */
export type StripeConnectionState = {
  provider: "stripe"
  connectionStatus: StripeConnectionStatus
  accountConnected: boolean
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  requirementsCurrentlyDue: string[]
  requirementsPastDue: string[]
  requirementsPendingVerification: string[]
  outstandingRequirementCount: number
  disabledReason: string | null
  lastSyncedAt: string | null
}

export function getStripeConnectStatus(credentials?: StripeConnectCredentials | null): {
  status: "not_started" | "pending" | "active"
  enabled: boolean
} {
  if (!String(credentials?.stripe_account_id || "").trim()) {
    return { status: "not_started", enabled: false }
  }
  if (credentials?.charges_enabled === true) return { status: "active", enabled: true }
  return { status: "pending", enabled: false }
}

function sanitizeConnectCredentials(credentials: StripeConnectCredentials): StripeConnectCredentials {
  return {
    ...(credentials.stripe_account_id ? { stripe_account_id: credentials.stripe_account_id } : {}),
    ...(credentials.details_submitted !== undefined ? { details_submitted: credentials.details_submitted } : {}),
    ...(credentials.charges_enabled !== undefined ? { charges_enabled: credentials.charges_enabled } : {}),
    ...(credentials.payouts_enabled !== undefined ? { payouts_enabled: credentials.payouts_enabled } : {}),
    ...(credentials.connect_onboarding_started_at ? { connect_onboarding_started_at: credentials.connect_onboarding_started_at } : {}),
    ...(credentials.connect_last_synced_at ? { connect_last_synced_at: credentials.connect_last_synced_at } : {}),
    ...(credentials.connection_status ? { connection_status: credentials.connection_status } : {}),
    ...(Array.isArray(credentials.requirements_currently_due) ? { requirements_currently_due: credentials.requirements_currently_due } : {}),
    ...(Array.isArray(credentials.requirements_eventually_due) ? { requirements_eventually_due: credentials.requirements_eventually_due } : {}),
    ...(Array.isArray(credentials.requirements_past_due) ? { requirements_past_due: credentials.requirements_past_due } : {}),
    ...(Array.isArray(credentials.requirements_pending_verification) ? { requirements_pending_verification: credentials.requirements_pending_verification } : {}),
    ...(credentials.disabled_reason !== undefined ? { disabled_reason: credentials.disabled_reason } : {}),
    ...(credentials.capabilities ? { capabilities: credentials.capabilities } : {}),
    ...(credentials.provider_model ? { provider_model: credentials.provider_model } : {}),
    ...(credentials.card_in_person_enabled !== undefined ? { card_in_person_enabled: credentials.card_in_person_enabled } : {}),
    ...(credentials.card_manual_entry_enabled !== undefined ? { card_manual_entry_enabled: credentials.card_manual_entry_enabled } : {}),
    ...(credentials.card_routing_preference ? { card_routing_preference: credentials.card_routing_preference } : {})
  }
}

async function getConnectCredentials(merchantId: string): Promise<StripeConnectCredentials> {
  const { data, error } = await getDb()
    .from("merchant_providers")
    .select("credentials")
    .eq("merchant_id", merchantId)
    .eq("provider", "stripe")
    .maybeSingle()

  if (error) throw new Error(`Failed loading Stripe Connect setup: ${error.message}`)
  return (data?.credentials || {}) as StripeConnectCredentials
}

async function upsertConnectSetup(
  merchantId: string,
  credentials: StripeConnectCredentials,
  status: string,
  enabled: boolean
): Promise<void> {
  const { error } = await getDb()
    .from("merchant_providers")
    .upsert(
      {
        merchant_id: merchantId,
        provider: "stripe",
        status,
        enabled,
        credentials: sanitizeConnectCredentials(credentials),
        updated_at: new Date().toISOString()
      },
      { onConflict: "merchant_id,provider" }
    )

  if (error) throw new Error(`Failed saving Stripe Connect setup: ${error.message}`)
}

export async function startStripeConnectOnboarding(args: {
  merchantId: string
}): Promise<{ ok: true; url: string; applicationStatus: "pending" } | { ok: false; error: string }> {
  const returnUrl = String(process.env.NEXT_PUBLIC_STRIPE_CONNECT_RETURN_URL || "").trim()
  const refreshUrl = String(process.env.NEXT_PUBLIC_STRIPE_CONNECT_REFRESH_URL || "").trim()

  if (!returnUrl || !refreshUrl) {
    return { ok: false, error: "Stripe Connect is not configured yet." }
  }

  const existing = await getConnectCredentials(args.merchantId)
  let stripeAccountId = String(existing.stripe_account_id || "").trim()

  if (!stripeAccountId) {
    const account = await createStripeConnectedAccount({ merchantId: args.merchantId })
    stripeAccountId = account.id
  }

  const link = await createStripeOnboardingLink({
    accountId: stripeAccountId,
    returnUrl,
    refreshUrl
  })

  const now = new Date().toISOString()
  const credentials: StripeConnectCredentials = {
    ...existing,
    stripe_account_id: stripeAccountId,
    connect_onboarding_started_at: existing.connect_onboarding_started_at || now
  }

  await upsertConnectSetup(args.merchantId, credentials, "pending", false)

  return { ok: true, url: link.url, applicationStatus: "pending" }
}

export async function syncStripeConnectAccount(args: {
  merchantId: string
}): Promise<
  | {
      ok: true
      status: string
      enabled: boolean
      readyForPayments: boolean
      onboardingStatus: "pending" | "complete"
    }
  | { ok: false; error: string }
> {
  const existing = await getConnectCredentials(args.merchantId)
  const stripeAccountId = String(existing.stripe_account_id || "").trim()

  if (!stripeAccountId) {
    return { ok: false, error: "No Stripe connected account found for this merchant." }
  }

  const account = await retrieveStripeConnectedAccount(stripeAccountId)

  const { status, enabled } = getStripeConnectStatus({
    stripe_account_id: stripeAccountId,
    details_submitted: account.detailsSubmitted,
    charges_enabled: account.chargesEnabled,
    payouts_enabled: account.payoutsEnabled
  })

  const credentials: StripeConnectCredentials = {
    ...existing,
    stripe_account_id: stripeAccountId,
    details_submitted: account.detailsSubmitted,
    charges_enabled: account.chargesEnabled,
    payouts_enabled: account.payoutsEnabled,
    connect_last_synced_at: new Date().toISOString()
  }

  await upsertConnectSetup(args.merchantId, credentials, status, enabled)

  return {
    ok: true,
    status,
    enabled,
    readyForPayments: enabled,
    onboardingStatus: enabled ? "complete" : "pending"
  }
}

/** Connect-webhook entry point. Resolves the merchant from the stored account mapping. */
export async function syncStripeConnectAccountByProviderAccountId(accountId: string) {
  const normalized = String(accountId || "").trim()
  if (!normalized) return null
  const { data, error } = await getDb()
    .from("merchant_providers")
    .select("merchant_id")
    .eq("provider", "stripe")
    .contains("credentials", { stripe_account_id: normalized })
    .maybeSingle()
  if (error) throw new Error(`Failed resolving Stripe account owner: ${error.message}`)
  if (!data?.merchant_id) return null
  return syncStripeConnectAccount({ merchantId: String(data.merchant_id) })
}

export async function getMerchantStripeAccountId(merchantId: string): Promise<string | undefined> {
  const credentials = await getConnectCredentials(merchantId)
  return String(credentials.stripe_account_id || "").trim() || undefined
}

// ─── Card acceptance settings & terminal readiness ───────────────────────────

export type StripeCardRoutingPreference = "automatic" | "terminal_first" | "tap_to_pay_first"

export type StripeCardSettings = {
  inPersonEnabled: boolean
  manualEntryEnabled: boolean
  routingPreference: StripeCardRoutingPreference
}

function normalizeRoutingPreference(value: unknown): StripeCardRoutingPreference {
  const normalized = String(value || "").trim()
  if (normalized === "terminal_first" || normalized === "tap_to_pay_first") return normalized
  return "automatic"
}

function cardSettingsFromCredentials(credentials: StripeConnectCredentials): StripeCardSettings {
  return {
    inPersonEnabled: credentials.card_in_person_enabled === true,
    manualEntryEnabled: credentials.card_manual_entry_enabled === true,
    routingPreference: normalizeRoutingPreference(credentials.card_routing_preference)
  }
}

/**
 * The merchant's full Stripe provider row context used for card routing:
 * online enablement (the merchant_providers enabled flag), the normalized
 * connection state, and in-person card settings.
 */
export type StripeCardProviderContext = {
  accountId: string | null
  onlineEnabled: boolean
  connection: StripeConnectionState
  settings: StripeCardSettings
}

export async function getStripeCardProviderContext(merchantId: string): Promise<StripeCardProviderContext> {
  const { data, error } = await getDb()
    .from("merchant_providers")
    .select("enabled, status, credentials")
    .eq("merchant_id", merchantId)
    .eq("provider", "stripe")
    .maybeSingle()

  if (error) throw new Error(`Failed loading Stripe provider context: ${error.message}`)

  const credentials = (data?.credentials || {}) as StripeConnectCredentials

  return {
    accountId: String(credentials.stripe_account_id || "").trim() || null,
    onlineEnabled: data?.enabled === true,
    connection: connectionStateFromCredentials(credentials),
    settings: cardSettingsFromCredentials(credentials)
  }
}

export async function updateStripeCardSettingsEngine(
  merchantId: string,
  patch: Partial<StripeCardSettings>
): Promise<StripeCardSettings> {
  const existing = await getConnectCredentials(merchantId)
  const current = cardSettingsFromCredentials(existing)
  const next: StripeCardSettings = {
    inPersonEnabled: patch.inPersonEnabled ?? current.inPersonEnabled,
    manualEntryEnabled: patch.manualEntryEnabled ?? current.manualEntryEnabled,
    routingPreference: normalizeRoutingPreference(patch.routingPreference ?? current.routingPreference)
  }

  const credentials: StripeConnectCredentials = {
    ...existing,
    card_in_person_enabled: next.inPersonEnabled,
    card_manual_entry_enabled: next.manualEntryEnabled,
    card_routing_preference: next.routingPreference
  }

  const connection = connectionStateFromCredentials(credentials)
  const row = rowStatusForConnection(connection.connectionStatus)
  await upsertConnectSetup(
    merchantId,
    credentials,
    connection.accountConnected ? row.status : "not_started",
    connection.connectionStatus === "active" ? row.enabled : false
  )

  return next
}

/**
 * Gate for every Stripe Terminal operation: the merchant must have a
 * connected account with charges enabled (onboarding sufficiently complete).
 */
export async function getStripeTerminalReadiness(merchantId: string): Promise<
  | { ready: true; accountId: string }
  | { ready: false; accountId: string | null; reason: string }
> {
  const context = await getStripeCardProviderContext(merchantId)

  if (!context.accountId) {
    return { ready: false, accountId: null, reason: "Stripe is not connected for this merchant." }
  }
  if (!context.connection.chargesEnabled) {
    return {
      ready: false,
      accountId: context.accountId,
      reason: "Stripe onboarding is not complete. Finish onboarding before using in-person payments."
    }
  }

  return { ready: true, accountId: context.accountId }
}

// ─── Embedded onboarding (Account Sessions) ──────────────────────────────────

const STRIPE_CONNECT_PROVIDER_MODEL = "stripe_connect_embedded"

function emptyStripeConnectionState(): StripeConnectionState {
  return {
    provider: "stripe",
    connectionStatus: "not_connected",
    accountConnected: false,
    detailsSubmitted: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    requirementsCurrentlyDue: [],
    requirementsPastDue: [],
    requirementsPendingVerification: [],
    outstandingRequirementCount: 0,
    disabledReason: null,
    lastSyncedAt: null
  }
}

function connectionStateFromCredentials(credentials: StripeConnectCredentials): StripeConnectionState {
  if (!String(credentials.stripe_account_id || "").trim()) {
    return emptyStripeConnectionState()
  }

  const currentlyDue = Array.isArray(credentials.requirements_currently_due)
    ? credentials.requirements_currently_due
    : []
  const pastDue = Array.isArray(credentials.requirements_past_due)
    ? credentials.requirements_past_due
    : []
  const pendingVerification = Array.isArray(credentials.requirements_pending_verification)
    ? credentials.requirements_pending_verification
    : []

  return {
    provider: "stripe",
    connectionStatus: credentials.connection_status || "onboarding_required",
    accountConnected: true,
    detailsSubmitted: credentials.details_submitted === true,
    chargesEnabled: credentials.charges_enabled === true,
    payoutsEnabled: credentials.payouts_enabled === true,
    requirementsCurrentlyDue: currentlyDue,
    requirementsPastDue: pastDue,
    requirementsPendingVerification: pendingVerification,
    outstandingRequirementCount: currentlyDue.length + pastDue.length,
    disabledReason: credentials.disabled_reason ?? null,
    lastSyncedAt: credentials.connect_last_synced_at || null
  }
}

/**
 * Maps the normalized PineTree connection status onto the merchant_providers
 * row vocabulary. Only "active" marks the provider ready; enabled mirrors
 * the legacy hosted-flow behavior (auto-enabled once charges are live).
 */
function rowStatusForConnection(status: StripeConnectionStatus): { status: string; enabled: boolean } {
  if (status === "active") return { status: "active", enabled: true }
  if (status === "disabled") return { status: "disabled", enabled: false }
  if (status === "restricted") return { status: "restricted", enabled: false }
  return { status: "pending", enabled: false }
}

function credentialsFromNormalizedConnection(
  existing: StripeConnectCredentials,
  accountId: string,
  normalized: StripeNormalizedConnection,
  syncedAt: string
): StripeConnectCredentials {
  return {
    ...existing,
    stripe_account_id: accountId,
    details_submitted: normalized.detailsSubmitted,
    charges_enabled: normalized.chargesEnabled,
    payouts_enabled: normalized.payoutsEnabled,
    connection_status: normalized.connectionStatus,
    requirements_currently_due: normalized.requirementsCurrentlyDue,
    requirements_eventually_due: normalized.requirementsEventuallyDue,
    requirements_past_due: normalized.requirementsPastDue,
    requirements_pending_verification: normalized.requirementsPendingVerification,
    disabled_reason: normalized.disabledReason,
    capabilities: normalized.capabilities,
    provider_model: STRIPE_CONNECT_PROVIDER_MODEL,
    connect_last_synced_at: syncedAt
  }
}

/**
 * Returns the merchant's connected-account ID, creating the connected
 * account first if none exists. Never creates a duplicate: an existing
 * stripe_account_id is always reused, and the ID is persisted before the
 * function returns so a resumed onboarding finds it.
 */
async function ensureStripeAccountId(merchantId: string): Promise<{
  accountId: string
  created: boolean
  credentials: StripeConnectCredentials
}> {
  const existing = await getConnectCredentials(merchantId)
  const existingAccountId = String(existing.stripe_account_id || "").trim()

  if (existingAccountId) {
    return { accountId: existingAccountId, created: false, credentials: existing }
  }

  const account = await createStripeConnectedAccount({ merchantId })
  const now = new Date().toISOString()
  const credentials: StripeConnectCredentials = {
    ...existing,
    stripe_account_id: account.id,
    details_submitted: account.detailsSubmitted,
    charges_enabled: account.chargesEnabled,
    payouts_enabled: account.payoutsEnabled,
    connection_status: "onboarding_required",
    provider_model: STRIPE_CONNECT_PROVIDER_MODEL,
    connect_onboarding_started_at: existing.connect_onboarding_started_at || now
  }

  await upsertConnectSetup(merchantId, credentials, "pending", false)

  return { accountId: account.id, created: true, credentials }
}

/**
 * Ensures the merchant has a Stripe connected account and returns the safe
 * normalized connection state. Creates an account only when none exists.
 */
export async function ensureStripeConnectedAccountEngine(args: {
  merchantId: string
}): Promise<{ ok: true; created: boolean; connection: StripeConnectionState } | { ok: false; error: string }> {
  try {
    const { created, credentials } = await ensureStripeAccountId(args.merchantId)
    return { ok: true, created, connection: connectionStateFromCredentials(credentials) }
  } catch (error) {
    console.error("Stripe connected account setup failed:", error instanceof Error ? error.message : error)
    return { ok: false, error: "Unable to set up Stripe for this merchant right now." }
  }
}

/**
 * Creates an embedded-onboarding Account Session for the authenticated
 * merchant's connected account (creating the account first if needed).
 * The client secret is returned to the caller only — never persisted,
 * never logged.
 */
export async function createStripeAccountSessionEngine(args: {
  merchantId: string
}): Promise<{ ok: true; clientSecret: string } | { ok: false; error: string }> {
  try {
    const { accountId } = await ensureStripeAccountId(args.merchantId)
    const session = await createStripeAccountSession({ accountId })
    return { ok: true, clientSecret: session.clientSecret }
  } catch (error) {
    console.error("Stripe onboarding session creation failed:", error instanceof Error ? error.message : error)
    return { ok: false, error: "Unable to start Stripe onboarding right now." }
  }
}

/**
 * Retrieves current Stripe account state, normalizes it, synchronizes the
 * PineTree database (source of truth for merchant/provider connection
 * status), and returns the safe normalized state.
 */
export async function syncStripeConnectionEngine(args: {
  merchantId: string
}): Promise<{ ok: true; connection: StripeConnectionState } | { ok: false; error: string }> {
  const existing = await getConnectCredentials(args.merchantId)
  const accountId = String(existing.stripe_account_id || "").trim()

  if (!accountId) {
    return { ok: true, connection: emptyStripeConnectionState() }
  }

  let normalized: StripeNormalizedConnection
  try {
    const details = await retrieveStripeConnectedAccountDetails(accountId)

    // Tenant-isolation guard: the account's PineTree binding metadata must
    // match the authenticated merchant. A mismatch means the stored account
    // ID does not belong to this merchant — never sync or expose it.
    const boundMerchantId = String(details.metadata[STRIPE_MERCHANT_METADATA_KEY] || "").trim()
    if (boundMerchantId && boundMerchantId !== args.merchantId) {
      console.error("Stripe connected account merchant binding mismatch detected")
      return { ok: false, error: "Stripe account is not linked to this merchant." }
    }

    normalized = normalizeStripeAccountStatus(details)
  } catch (error) {
    console.error("Stripe connection sync failed:", error instanceof Error ? error.message : error)
    return { ok: false, error: "Unable to refresh Stripe status right now." }
  }

  const syncedAt = new Date().toISOString()
  const credentials = credentialsFromNormalizedConnection(existing, accountId, normalized, syncedAt)
  const row = rowStatusForConnection(normalized.connectionStatus)

  await upsertConnectSetup(args.merchantId, credentials, row.status, row.enabled)

  return { ok: true, connection: connectionStateFromCredentials(credentials) }
}
