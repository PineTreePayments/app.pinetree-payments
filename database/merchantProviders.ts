import { supabase, supabaseAdmin } from "./supabase"
import type { NwcCapabilities } from "@/providers/lightning/nwcClient"

const db = supabaseAdmin || supabase

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
