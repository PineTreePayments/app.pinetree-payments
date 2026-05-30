import { supabaseAdmin, supabase } from "@/database"
import { refreshWalletBalancesEngine } from "./walletOverview"
import { loadProviders } from "./loadProviders"
import { getProviderMetadata } from "./providerRegistry"
import { getLightningNwcReadiness, SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import type { SpeedMode } from "@/providers/lightning/speedClient"
import { maskSpeedKey } from "@/providers/lightning/speedClient"

const db = supabaseAdmin || supabase

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

type LightningDashboardStatus =
  | "not_configured"
  | "address_needs_verification"
  | "provider_unavailable"
  | "connected"

type ProviderRow = {
  provider: string
  status: string
  enabled: boolean
  credentials?: JsonObject | null
  dashboard_status?: LightningDashboardStatus | string
  capabilities?: {
    supportsLightningInvoice?: boolean
    supportsFeeAtPaymentTime?: boolean
    supportsSplitSettlement?: boolean
    supportsWebhookConfirmation?: boolean
  } | null
  readiness?: {
    ready: boolean
    missingPermissions: string[]
    reason: string | null
  } | null
}

type WalletRow = {
  id?: string
  merchant_id: string
  network: string
  asset: string
  wallet_address: string
  wallet_type?: string | null
  status?: string | null
}

export type ProvidersDashboardData = {
  providers: ProviderRow[]
  wallets: WalletRow[]
  settings: {
    smart_routing_enabled: boolean
    auto_conversion_enabled: boolean
  }
}

function hasNwcConnection(row?: ProviderRow | null): boolean {
  if (!row) return false
  const status = String(row.status || "").toLowerCase().trim()
  return status === "connected" || status === "active"
}

function getLightningCapabilities() {
  const metadata = getProviderMetadata("lightning_nwc")
  const capabilities = metadata?.capabilities

  return {
    supportsLightningInvoice: Boolean(capabilities?.supportsLightningInvoice),
    supportsFeeAtPaymentTime: Boolean(capabilities?.supportsFeeAtPaymentTime),
    supportsSplitSettlement: Boolean(capabilities?.supportsSplitSettlement),
    supportsWebhookConfirmation: Boolean(capabilities?.supportsWebhookConfirmation)
  }
}

function getLightningDashboardStatus(row?: ProviderRow | null): LightningDashboardStatus {
  if (!hasNwcConnection(row)) return "not_configured"
  return "connected"
}

function decorateProviderRows(rows: ProviderRow[]): ProviderRow[] {
  const providersByKey = new Map(rows.map((row) => [row.provider, row]))
  const nwcRow = providersByKey.get("lightning_nwc")
  const speedRow = providersByKey.get(SPEED_PROVIDER_NAME)
  const lightningCapabilities = getLightningCapabilities()
  const lightningStatus = getLightningDashboardStatus(nwcRow)

  // Exclude raw internal rows — sanitized rows are synthesized below.
  // This prevents nwc_uri and speed_secret_key from ever reaching the UI.
  const decoratedRows: ProviderRow[] = rows.filter(
    (row) =>
      row.provider !== "lightning" &&
      row.provider !== "lightning_nwc" &&
      row.provider !== SPEED_PROVIDER_NAME
  )

  // ── NWC Lightning (Advanced) ──────────────────────────────────────────────
  if (nwcRow) {
    const readiness = getLightningNwcReadiness(
      nwcRow.credentials?.capabilities as Parameters<typeof getLightningNwcReadiness>[0]
    )
    const safeCredentials: JsonObject = {
      wallet_label: String(nwcRow.credentials?.wallet_label || "Lightning Wallet"),
      last_tested_at: (nwcRow.credentials?.last_tested_at as string | null) ?? null,
      provider_model: "nwc_merchant_wallet"
    }

    decoratedRows.push({
      provider: "lightning",
      status: nwcRow.status,
      enabled: lightningStatus === "connected" ? Boolean(nwcRow.enabled) : false,
      credentials: safeCredentials,
      dashboard_status: lightningStatus,
      capabilities: lightningCapabilities,
      readiness
    })
  } else {
    decoratedRows.push({
      provider: "lightning",
      status: "disconnected",
      enabled: false,
      credentials: {},
      dashboard_status: "not_configured" as LightningDashboardStatus,
      capabilities: lightningCapabilities,
      readiness: {
        ready: false,
        missingPermissions: ["make_invoice", "lookup_invoice", "pay_invoice"],
        reason: "Connect an NWC wallet before enabling Bitcoin Lightning."
      }
    })
  }

  // ── Speed Lightning (Recommended) ─────────────────────────────────────────
  // Synthesize a safe row — never include speed_secret_key in the response.
  if (speedRow && (speedRow.status === "connected" || speedRow.status === "active")) {
    const rawCreds = speedRow.credentials || {}
    const mode = (rawCreds.mode as SpeedMode) || "unknown"
    const rawKey = typeof rawCreds.speed_secret_key === "string" ? rawCreds.speed_secret_key : ""
    const safeSpeedCredentials: JsonObject = {
      mode,
      masked_key: rawKey ? maskSpeedKey(rawKey) : null,
      account_id: (rawCreds.speed_account_id as string | null) ?? null,
      webhook_configured: Boolean(rawCreds.webhook_secret),
      tested_at: (rawCreds.tested_at as string | null) ?? null,
      provider_model: "speed_merchant_account"
    }

    decoratedRows.push({
      provider: SPEED_PROVIDER_NAME,
      status: speedRow.status,
      enabled: false,
      credentials: safeSpeedCredentials,
      dashboard_status: "connected" as LightningDashboardStatus,
      capabilities: null,
      readiness: {
        ready: false,
        missingPermissions: [],
        reason: "Speed setup connected. Payment processing integration is pending."
      }
    })
  } else {
    decoratedRows.push({
      provider: SPEED_PROVIDER_NAME,
      status: "disconnected",
      enabled: false,
      credentials: {},
      dashboard_status: "not_configured" as LightningDashboardStatus,
      capabilities: null,
      readiness: null
    })
  }

  return decoratedRows
}

async function ensureMerchant(merchantId: string) {
  const { data, error } = await db
    .from("merchants")
    .select("id")
    .eq("id", merchantId)
    .maybeSingle()

  if (error) {
    throw new Error(`Merchant lookup failed: ${error.message}`)
  }

  if (!data) {
    const { error: insertError } = await db
      .from("merchants")
      .insert({ id: merchantId })

    if (insertError) {
      throw new Error(`Merchant create failed: ${insertError.message}`)
    }
  }
}

async function ensureMerchantSettings(merchantId: string) {
  const { data, error } = await db
    .from("merchant_settings")
    .select("smart_routing_enabled, auto_conversion_enabled")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) {
    throw new Error(`Settings lookup failed: ${error.message}`)
  }

  if (!data) {
    const { error: insertError } = await db
      .from("merchant_settings")
      .insert({
        merchant_id: merchantId,
        smart_routing_enabled: false,
        auto_conversion_enabled: false
      })

    if (insertError) {
      throw new Error(`Settings create failed: ${insertError.message}`)
    }

    return {
      smart_routing_enabled: false,
      auto_conversion_enabled: false
    }
  }

  return {
    smart_routing_enabled: Boolean(data.smart_routing_enabled),
    auto_conversion_enabled: Boolean(data.auto_conversion_enabled)
  }
}

export async function getProvidersDashboardEngine(merchantId: string): Promise<ProvidersDashboardData> {
  await loadProviders()
  await ensureMerchant(merchantId)

  const [providersRes, walletsRes, settings] = await Promise.all([
    db.from("merchant_providers").select("*").eq("merchant_id", merchantId),
    db.from("merchant_wallets").select("*").eq("merchant_id", merchantId),
    ensureMerchantSettings(merchantId)
  ])

  if (providersRes.error) {
    throw new Error(`Failed to load providers: ${providersRes.error.message}`)
  }

  if (walletsRes.error) {
    throw new Error(`Failed to load wallets: ${walletsRes.error.message}`)
  }

  return {
    providers: decorateProviderRows((providersRes.data || []) as ProviderRow[]),
    wallets: walletsRes.data || [],
    settings
  }
}

export async function updateProviderSettingEngine(
  merchantId: string,
  field: "smart_routing_enabled" | "auto_conversion_enabled",
  value: boolean
) {
  await ensureMerchant(merchantId)
  const { error } = await db
    .from("merchant_settings")
    .upsert(
      {
        merchant_id: merchantId,
        [field]: value
      },
      { onConflict: "merchant_id" }
    )

  if (error) {
    throw new Error(`Failed to update settings: ${error.message}`)
  }
}

export async function toggleProviderEngine(
  merchantId: string,
  provider: string,
  enabled: boolean
) {
  await loadProviders()

  if (provider === "lightning" && enabled) {
    const { data, error: lookupError } = await db
      .from("merchant_providers")
      .select("id, credentials")
      .eq("merchant_id", merchantId)
      .eq("provider", "lightning_nwc")
      .in("status", ["connected", "active"])
      .maybeSingle()

    if (lookupError) {
      throw new Error(`Failed checking Lightning provider: ${lookupError.message}`)
    }

    if (!data) {
      throw new Error("Connect a Lightning wallet with make_invoice, lookup_invoice, and pay_invoice before enabling Bitcoin Lightning payments.")
    }

    const readiness = getLightningNwcReadiness(
      (data.credentials as JsonObject | null | undefined)?.capabilities as Parameters<typeof getLightningNwcReadiness>[0]
    )
    if (!readiness.ready) {
      throw new Error(readiness.reason || "Lightning wallet is connected but not ready for live payments.")
    }
  }

  // Map UI provider key "lightning" to the actual DB row key "lightning_nwc"
  const targetProvider = provider === "lightning" ? "lightning_nwc" : provider

  const { error } = await db
    .from("merchant_providers")
    .update({ enabled })
    .eq("merchant_id", merchantId)
    .eq("provider", targetProvider)

  if (error) {
    throw new Error(`Failed to toggle provider: ${error.message}`)
  }
}

export async function disconnectProviderEngine(merchantId: string, provider: string) {
  if (provider === "solana" || provider === "base") {
    const { error: walletDeleteError } = await db
      .from("merchant_wallets")
      .delete()
      .eq("merchant_id", merchantId)
      .eq("network", provider)

    if (walletDeleteError) {
      throw new Error(`Failed deleting wallet: ${walletDeleteError.message}`)
    }

    if (provider === "solana") {
      await db
        .from("wallet_balances")
        .delete()
        .eq("merchant_id", merchantId)
        .eq("asset", "SOL")
    }
  }

  // Speed disconnect is handled via its dedicated route — not this general path.
  // The Speed card disconnect button calls /api/wallets/lightning/speed/connect directly.
  if (provider === SPEED_PROVIDER_NAME) {
    throw new Error("Use the Speed Lightning disconnect route to disconnect Speed.")
  }

  // Map UI provider key "lightning" to the actual DB row key "lightning_nwc"
  const targetProvider = provider === "lightning" ? "lightning_nwc" : provider

  const { error: providerError } = await db
    .from("merchant_providers")
    .update({
      status: "disconnected",
      enabled: false,
      credentials: {}
    })
    .eq("merchant_id", merchantId)
    .eq("provider", targetProvider)

  if (providerError) {
    throw new Error(`Failed disconnecting provider: ${providerError.message}`)
  }
}

export async function saveProviderEngine(args: {
  merchantId: string
  provider: string
  walletAddress?: string
  walletType?: string | null
  apiKey?: string
}) {
  await loadProviders()
  const { merchantId, provider, walletAddress, walletType, apiKey } = args

  let credentials: JsonObject = {}

  if (provider === "solana" || provider === "base") {
    const address = String(walletAddress || "").trim()
    if (!address) {
      throw new Error("Wallet address required")
    }

    const asset = provider === "solana"
      ? `SOL-${walletType || "MANUAL"}`
      : `ETH-${walletType || "BASEAPP"}`

    const { data: existing, error: existingError } = await db
      .from("merchant_wallets")
      .select("id")
      .eq("merchant_id", merchantId)
      .eq("network", provider)
      .maybeSingle()

    if (existingError) {
      throw new Error(`Failed checking wallet row: ${existingError.message}`)
    }

    if (existing?.id) {
      const { error } = await db
        .from("merchant_wallets")
        .update({
          asset,
          wallet_address: address,
          wallet_type: walletType || null
        })
        .eq("id", existing.id)

      if (error) {
        throw new Error(`Failed updating wallet: ${error.message}`)
      }
    } else {
      const { error } = await db
        .from("merchant_wallets")
        .insert({
          merchant_id: merchantId,
          network: provider,
          asset,
          wallet_address: address,
          wallet_type: walletType || null
        })

      if (error) {
        throw new Error(`Failed inserting wallet: ${error.message}`)
      }
    }

    credentials = {
      wallet: address,
      wallet_type: walletType || null
    }
  } else if (provider === "lightning") {
    // NWC Lightning is connected via /api/wallets/lightning/connect — not this path.
    throw new Error("Use the Lightning wallet connection flow to connect a Bitcoin Lightning wallet.")
  } else {
    if (!apiKey) {
      throw new Error("API key required")
    }

    credentials = { api_key: apiKey }
  }

  const { error: providerError } = await db
    .from("merchant_providers")
    .upsert(
      {
        merchant_id: merchantId,
        provider,
        status: "connected",
        enabled: provider === "lightning" ? false : true,
        credentials
      },
      { onConflict: "merchant_id,provider" }
    )

  if (providerError) {
    throw new Error(`Failed saving provider: ${providerError.message}`)
  }

  if (provider === "solana" || provider === "base") {
    await refreshWalletBalancesEngine(merchantId)
  }
}
