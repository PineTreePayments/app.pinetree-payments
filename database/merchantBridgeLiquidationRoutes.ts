/**
 * Bridge liquidation routes - persistence.
 *
 * A liquidation route is the PERMANENT pairing of one source chain + asset with
 * one merchant bank destination. Bridge issues a deposit address for it once
 * and that address never changes, so PineTree stores the route and reuses it
 * rather than asking Bridge for a new one on every withdrawal.
 *
 * TENANT SAFETY: every read and write filters by merchant_id, except the
 * webhook owner lookup, which resolves the tenant FROM the stored provider
 * identifier and returns the owning row.
 *
 * MERCHANT-FACING: nothing here is. The merchant sees their bank destination;
 * "liquidation address" is infrastructure vocabulary that never reaches the UI.
 */

import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase
const TABLE = "merchant_bridge_liquidation_routes"

export type LiquidationRouteRail = "base" | "solana"

export type MerchantBridgeLiquidationRoute = {
  id: string
  merchant_id: string
  bank_destination_id: string
  provider_customer_id: string
  provider_external_account_id: string
  /** Bridge's liquidation-address id. */
  provider_liquidation_address_id: string
  /** The on-chain address a merchant withdrawal is sent to. */
  deposit_address: string
  source_rail: LiquidationRouteRail
  source_asset: string
  destination_payment_rail: string
  destination_currency: string
  /** Same-chain address Bridge returns unprocessable deposits to. */
  return_address: string
  state: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

function normalize(row: Record<string, unknown>): MerchantBridgeLiquidationRoute {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    bank_destination_id: String(row.bank_destination_id || ""),
    provider_customer_id: String(row.provider_customer_id || ""),
    provider_external_account_id: String(row.provider_external_account_id || ""),
    provider_liquidation_address_id: String(row.provider_liquidation_address_id || ""),
    deposit_address: String(row.deposit_address || ""),
    source_rail: String(row.source_rail || "base") as LiquidationRouteRail,
    source_asset: String(row.source_asset || "USDC"),
    destination_payment_rail: String(row.destination_payment_rail || "ach"),
    destination_currency: String(row.destination_currency || "usd"),
    return_address: String(row.return_address || ""),
    state: String(row.state || "active"),
    archived_at: row.archived_at != null ? String(row.archived_at) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

/**
 * The stored route for one (merchant, bank destination, rail, asset) tuple.
 *
 * This lookup is the first line of duplicate prevention: PineTree reuses what
 * it already has before it ever asks Bridge to enumerate or create.
 */
export async function findLiquidationRoute(input: {
  merchantId: string
  bankDestinationId: string
  sourceRail: LiquidationRouteRail
  sourceAsset: string
}): Promise<MerchantBridgeLiquidationRoute | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", input.merchantId)
    .eq("bank_destination_id", input.bankDestinationId)
    .eq("source_rail", input.sourceRail)
    .eq("source_asset", input.sourceAsset)
    .is("archived_at", null)
    .maybeSingle()

  if (error) throw new Error(`Failed to load liquidation route: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function listLiquidationRoutes(
  merchantId: string
): Promise<MerchantBridgeLiquidationRoute[]> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })

  if (error) throw new Error(`Failed to list liquidation routes: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

/** How a verified drain webhook resolves its tenant. */
export async function findLiquidationRouteByProviderId(
  providerLiquidationAddressId: string
): Promise<MerchantBridgeLiquidationRoute | null> {
  const normalized = String(providerLiquidationAddressId || "").trim()
  if (!normalized) return null

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("provider_liquidation_address_id", normalized)
    .maybeSingle()

  if (error) throw new Error(`Failed to resolve liquidation route owner: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function getLiquidationRoute(
  merchantId: string,
  id: string
): Promise<MerchantBridgeLiquidationRoute | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load liquidation route: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

/**
 * Record a route.
 *
 * Upserts on the route identity so two concurrent withdrawal attempts converge
 * on one row instead of racing to create a second permanent route.
 */
export async function upsertLiquidationRoute(input: {
  merchantId: string
  bankDestinationId: string
  providerCustomerId: string
  providerExternalAccountId: string
  providerLiquidationAddressId: string
  depositAddress: string
  sourceRail: LiquidationRouteRail
  sourceAsset: string
  destinationPaymentRail: string
  destinationCurrency: string
  returnAddress: string
  state: string
}): Promise<MerchantBridgeLiquidationRoute> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        merchant_id: input.merchantId,
        bank_destination_id: input.bankDestinationId,
        provider_customer_id: input.providerCustomerId,
        provider_external_account_id: input.providerExternalAccountId,
        provider_liquidation_address_id: input.providerLiquidationAddressId,
        deposit_address: input.depositAddress,
        source_rail: input.sourceRail,
        source_asset: input.sourceAsset,
        destination_payment_rail: input.destinationPaymentRail,
        destination_currency: input.destinationCurrency,
        return_address: input.returnAddress,
        state: input.state,
        updated_at: now,
      },
      { onConflict: "merchant_id,bank_destination_id,source_rail,source_asset" }
    )
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to save liquidation route: ${error?.message || "No data returned"}`)
  }
  return normalize(data as Record<string, unknown>)
}

/** Archive every route bound to a bank destination the merchant removed. */
export async function archiveLiquidationRoutesForDestination(
  merchantId: string,
  bankDestinationId: string
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await db
    .from(TABLE)
    .update({ archived_at: now, state: "deactivated", updated_at: now })
    .eq("merchant_id", merchantId)
    .eq("bank_destination_id", bankDestinationId)
    .is("archived_at", null)

  if (error) throw new Error(`Failed to archive liquidation routes: ${error.message}`)
}
