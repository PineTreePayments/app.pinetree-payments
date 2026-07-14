import { supabase, supabaseAdmin } from "./supabase"
import type { NwcCapabilities } from "@/providers/lightning/nwcClient"
import type { SpeedMode } from "@/providers/lightning/speedClient"

const db = supabaseAdmin || supabase

const MERCHANT_PROVIDERS_UPDATED_AT_MISSING_MESSAGE =
  "merchant_providers.updated_at is missing. Run the migration to add updated_at and reload the Supabase schema cache."

function isMerchantProvidersUpdatedAtSchemaError(message?: string | null): boolean {
  const normalized = String(message || "").toLowerCase()
  return (
    normalized.includes("merchant_providers") &&
    normalized.includes("updated_at") &&
    (normalized.includes("schema cache") ||
      normalized.includes("could not find") ||
      normalized.includes("column"))
  )
}

function merchantProviderErrorMessage(error: { message?: string | null } | null | undefined): string {
  if (isMerchantProvidersUpdatedAtSchemaError(error?.message)) {
    return MERCHANT_PROVIDERS_UPDATED_AT_MISSING_MESSAGE
  }
  return error?.message || "unknown error"
}

// ─── Speed Provider ───────────────────────────────────────────────────────────

export const SPEED_PROVIDER_NAME = "lightning_speed"

type SpeedCredentials = {
  speed_account_id?: string
  speed_account_status?: string
  speed_managed_account_email?: string
  payout_destination?: string
  payout_type?: string
  setup_status?: string
  last_tested_at?: string
  mode?: SpeedMode
  provider_model: "pine_tree_speed_platform"
  notes?: string[]
}

export type MerchantSpeedStatus = {
  providerRowId: string
  connected: boolean
  mode: SpeedMode
  accountId: string | null
  accountStatus: string | null
  payoutDestination: string | null
  payoutType: string | null
  setupStatus: string
  lastTestedAt: string | null
  providerModel: "pine_tree_speed_platform"
  notes: string[]
  status: string
  readyForPayments: boolean
}

function buildSpeedStatus(
  id: string,
  status: string,
  creds: SpeedCredentials
): MerchantSpeedStatus {
  return {
    providerRowId: String(id),
    connected: true,
    mode: creds.mode || "unknown",
    accountId: creds.speed_account_id || null,
    accountStatus: creds.speed_account_status || null,
    payoutDestination: creds.payout_destination || null,
    payoutType: creds.payout_type || null,
    setupStatus: creds.setup_status || "pending_speed_connect_confirmation",
    lastTestedAt: creds.last_tested_at || null,
    providerModel: "pine_tree_speed_platform",
    notes: Array.isArray(creds.notes) ? creds.notes : [],
    status: String(status),
    readyForPayments: Boolean(
      creds.speed_account_id &&
      (creds.setup_status === "ready" || creds.setup_status === "ready_for_payments")
    )
  }
}

/** Returns the merchant's connected Speed provider row, or null if none. */
export async function getMerchantSpeedProvider(
  merchantId: string
): Promise<MerchantSpeedStatus | null> {
  const { data } = await db
    .from("merchant_providers")
    .select("id, status, credentials")
    .eq("merchant_id", merchantId)
    .eq("provider", SPEED_PROVIDER_NAME)
    .in("status", ["connected", "active"])
    .maybeSingle()

  if (!data?.credentials) return null

  const creds = data.credentials as SpeedCredentials
  if (creds.provider_model !== "pine_tree_speed_platform") return null

  return buildSpeedStatus(String(data.id), String(data.status), creds)
}

/**
 * Save or update merchant Speed settlement/onboarding placeholders.
 * No merchant-owned Speed API credentials are accepted or stored by default.
 */
export async function saveMerchantSpeedConnection(
  merchantId: string,
  params: {
    accountId?: string
    accountStatus?: string
    payoutDestination?: string
    payoutType?: string
    setupStatus?: string
    mode?: SpeedMode
    managedAccountEmail?: string
    notes?: string[]
    enabled?: boolean
  }
): Promise<{ providerRowId: string }> {
  const now = new Date().toISOString()

  const credentials: SpeedCredentials = {
    speed_account_id: params.accountId || undefined,
    speed_account_status: params.accountStatus || (params.accountId ? "configured" : "pending"),
    speed_managed_account_email: params.managedAccountEmail || undefined,
    payout_destination: params.payoutDestination || undefined,
    payout_type: params.payoutType || undefined,
    setup_status: params.setupStatus || "pending_speed_connect_confirmation",
    mode: params.mode || "unknown",
    last_tested_at: now,
    provider_model: "pine_tree_speed_platform",
    notes: params.notes || [
      "PineTree creates Speed Lightning payments through its platform account.",
      "Merchant settlement uses the configured Speed account ID."
    ]
  }

  const { data: existing } = await db
    .from("merchant_providers")
    .select("id")
    .eq("merchant_id", merchantId)
    .eq("provider", SPEED_PROVIDER_NAME)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await db
      .from("merchant_providers")
      .update({
        credentials,
        status: "connected",
        enabled: Boolean(params.enabled),
        updated_at: now
      })
      .eq("id", existing.id)

    if (error) {
      throw new Error(`Failed to save Speed connection: ${merchantProviderErrorMessage(error)}`)
    }

    return { providerRowId: String(existing.id) }
  }

  const { data: inserted, error } = await db
    .from("merchant_providers")
    .insert({
      merchant_id: merchantId,
      provider: SPEED_PROVIDER_NAME,
      status: "connected",
      enabled: Boolean(params.enabled),
      credentials,
      created_at: now,
      updated_at: now
    })
    .select("id")
    .single()

  if (error || !inserted?.id) {
    throw new Error(`Failed to save Speed connection: ${merchantProviderErrorMessage(error)}`)
  }

  return { providerRowId: String(inserted.id) }
}

/** Disconnect a merchant's Speed connection. Preserves row history. */
export async function disconnectMerchantSpeedConnection(merchantId: string): Promise<void> {
  const { error } = await db
    .from("merchant_providers")
    .update({
      status: "disconnected",
      enabled: false,
      credentials: {},
      updated_at: new Date().toISOString()
    })
    .eq("merchant_id", merchantId)
    .eq("provider", SPEED_PROVIDER_NAME)
    .in("status", ["connected", "active"])

  if (error) {
    throw new Error(`Failed to disconnect Speed connection: ${merchantProviderErrorMessage(error)}`)
  }
}

export const REQUIRED_NWC_PAYMENT_METHODS = [
  "make_invoice",
  "lookup_invoice",
  "pay_invoice"
] as const

export type LightningNwcReadiness = {
  ready: boolean
  missingPermissions: string[]
  reason: string | null
}

export function getLightningNwcReadiness(
  capabilities?: Partial<NwcCapabilities> | null
): LightningNwcReadiness {
  const missingPermissions: string[] = []

  if (!capabilities?.canMakeInvoice) missingPermissions.push("make_invoice")
  if (!capabilities?.canLookupInvoice) missingPermissions.push("lookup_invoice")
  if (!capabilities?.canPayInvoice) missingPermissions.push("pay_invoice")

  return {
    ready: missingPermissions.length === 0,
    missingPermissions,
    reason: missingPermissions.length
      ? `Bitcoin Lightning requires NWC permissions: ${missingPermissions.join(", ")}.`
      : null
  }
}

// ─── NWC Provider Functions ───────────────────────────────────────────────────

export type MerchantNwcSetup = {
  providerRowId: string
  nwcUri: string
  walletLabel: string
  capabilities: NwcCapabilities | null
  readiness: LightningNwcReadiness
  lastTestedAt: string | null
  status: string
}

/**
 * Returns the merchant's connected NWC Lightning provider row.
 * Returns null if no active NWC provider exists.
 *
 * SECURITY: nwcUri is returned to the engine layer only — never send to client.
 */
export async function getMerchantNwcSetup(
  merchantId: string
): Promise<MerchantNwcSetup | null> {
  const { data } = await db
    .from("merchant_providers")
    .select("id, status, credentials")
    .eq("merchant_id", merchantId)
    .eq("provider", "lightning_nwc")
    .in("status", ["connected", "active"])
    .maybeSingle()

  if (!data?.credentials) return null

  const creds = data.credentials as Record<string, unknown>
  const nwcUri = String(creds.nwc_uri || "").trim()
  const walletLabel = String(creds.wallet_label || "Lightning Wallet").trim()
  const lastTestedAt = typeof creds.last_tested_at === "string" ? creds.last_tested_at : null
  const rawCapabilities = creds.capabilities as NwcCapabilities | null | undefined

  if (!nwcUri) return null

  return {
    providerRowId: String(data.id || ""),
    nwcUri,
    walletLabel,
    capabilities: rawCapabilities || null,
    readiness: getLightningNwcReadiness(rawCapabilities || null),
    lastTestedAt,
    status: String(data.status || "")
  }
}

/**
 * Returns a safe (non-secret) summary of the merchant's NWC connection
 * suitable for use in UI status responses — no nwcUri included.
 */
export type MerchantNwcStatus = {
  providerRowId: string
  connected: boolean
  walletLabel: string
  capabilities: NwcCapabilities | null
  readiness: LightningNwcReadiness
  lastTestedAt: string | null
  status: string
}

export async function getMerchantNwcStatus(
  merchantId: string
): Promise<MerchantNwcStatus | null> {
  const setup = await getMerchantNwcSetup(merchantId)
  if (!setup) return null

  return {
    providerRowId: setup.providerRowId,
    connected: true,
    walletLabel: setup.walletLabel,
    capabilities: setup.capabilities,
    readiness: setup.readiness,
    lastTestedAt: setup.lastTestedAt,
    status: setup.status
  }
}

/**
 * Save or update a merchant's NWC wallet connection.
 *
 * SECURITY: nwcUri contains the client secret — never return it to the client.
 * Store in credentials JSONB. RLS + service role key prevent unauthorized access.
 */
export async function saveMerchantNwcConnection(
  merchantId: string,
  nwcUri: string,
  walletLabel: string,
  capabilities: NwcCapabilities
): Promise<{ providerRowId: string }> {
  const now = new Date().toISOString()
  const readiness = getLightningNwcReadiness(capabilities)

  const credentials = {
    nwc_uri: nwcUri,
    wallet_label: walletLabel,
    capabilities,
    last_tested_at: now,
    provider_model: "nwc_merchant_wallet"
  }

  // Upsert: update existing row if present, insert if not
  const { data: existing } = await db
    .from("merchant_providers")
    .select("id")
    .eq("merchant_id", merchantId)
    .eq("provider", "lightning_nwc")
    .maybeSingle()

  if (existing?.id) {
    const update: Record<string, unknown> = {
      credentials,
      status: "connected",
      updated_at: now
    }
    if (!readiness.ready) {
      update.enabled = false
    }

    await db
      .from("merchant_providers")
      .update(update)
      .eq("id", existing.id)

    return { providerRowId: String(existing.id) }
  }

  const { data: inserted, error } = await db
    .from("merchant_providers")
    .insert({
      merchant_id: merchantId,
      provider: "lightning_nwc",
      status: "connected",
      enabled: false,
      credentials,
      created_at: now,
      updated_at: now
    })
    .select("id")
    .single()

  if (error || !inserted?.id) {
    throw new Error(`Failed to save NWC connection: ${error?.message || "unknown error"}`)
  }

  return { providerRowId: String(inserted.id) }
}

/**
 * Disconnect a merchant's NWC wallet by setting status to "disconnected".
 * Does not delete the row to preserve history.
 */
export async function disconnectMerchantNwc(merchantId: string): Promise<void> {
  await db
    .from("merchant_providers")
    .update({
      status: "disconnected",
      updated_at: new Date().toISOString()
    })
    .eq("merchant_id", merchantId)
    .eq("provider", "lightning_nwc")
    .in("status", ["connected", "active"])
}
