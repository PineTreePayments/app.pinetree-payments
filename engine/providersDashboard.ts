import { supabaseAdmin, supabase } from "@/database"
import { refreshWalletBalancesEngine } from "./walletOverview"
import { loadProviders } from "./loadProviders"
import { getProviderMetadata } from "./providerRegistry"
import { getLightningNwcReadiness, SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getPineTreeSpeedConfigStatus } from "@/providers/lightning/speedClient"

const db = supabaseAdmin || supabase

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

type LightningDashboardStatus =
  | "not_configured"
  | "address_needs_verification"
  | "provider_unavailable"
  | "connected"

export type ProviderRow = {
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

export type WalletRow = {
  id?: string
  merchant_id: string
  network: string
  asset: string
  wallet_address: string
  wallet_type?: string | null
  status?: string | null
}

function oneWalletPerRail(wallets: WalletRow[]): WalletRow[] {
  const byNetwork = new Map<string, WalletRow>()
  for (const wallet of wallets) {
    const network = String(wallet.network || "").toLowerCase().trim()
    if (!network || byNetwork.has(network)) continue
    byNetwork.set(network, wallet)
  }
  return Array.from(byNetwork.values())
}

export type ProvidersDashboardData = {
  providers: ProviderRow[]
  wallets: WalletRow[]
  settings: {
    smart_routing_enabled: boolean
    auto_conversion_enabled: boolean
  }
}

export type OverviewRailReadiness = {
  id: string
  label: string
  status: "Connected" | "Not Connected" | "Requires Configuration" | "Disabled"
  detail: string
}

const OVERVIEW_RAILS = [
  { id: "coinbase", label: "Coinbase Business" },
  { id: "solana", label: "Solana Pay" },
  { id: "shift4", label: "Shift4" },
  { id: "base", label: "Base Pay" },
  { id: "lightning", label: "Bitcoin Lightning" }
] as const

export function buildOverviewRailReadiness(
  data: Pick<ProvidersDashboardData, "providers" | "wallets">
): OverviewRailReadiness[] {
  const provider = (id: string) => data.providers.find((row) => row.provider === id)
  const wallet = (id: string) => data.wallets.find((row) => row.network === id)

  return OVERVIEW_RAILS.map(({ id, label }) => {
    if (id === "solana" || id === "base") {
      const row = provider(id)
      const connectedWallet = wallet(id)
      if (!connectedWallet) {
        return { id, label, status: "Not Connected", detail: `Connect a ${label} wallet` }
      }
      if (row?.enabled === false) {
        return { id, label, status: "Disabled", detail: "Wallet connected; payment rail disabled" }
      }
      return { id, label, status: "Connected", detail: "Merchant wallet connected" }
    }

    if (id === "lightning") {
      const speed = provider(SPEED_PROVIDER_NAME)
      const nwc = provider("lightning")
      const speedConnected = Boolean(speed?.enabled && speed?.readiness?.ready)
      const nwcConnected = Boolean(
        nwc?.enabled &&
        nwc?.dashboard_status === "connected" &&
        (!nwc.readiness || nwc.readiness.ready)
      )
      if (speedConnected || nwcConnected) {
        return {
          id,
          label,
          status: "Connected",
          detail: speedConnected ? "Speed Lightning ready" : "NWC wallet ready"
        }
      }
      if (speed?.enabled === false || nwc?.enabled === false) {
        const hasConnection = speed?.dashboard_status === "connected" || nwc?.dashboard_status === "connected"
        if (hasConnection) return { id, label, status: "Disabled", detail: "Lightning connection is disabled" }
      }
      const reason = speed?.readiness?.reason || nwc?.readiness?.reason
      return {
        id,
        label,
        status: reason ? "Requires Configuration" : "Not Connected",
        detail: reason || "Connect Speed or an NWC wallet"
      }
    }

    const row = provider(id)
    if (!row) return { id, label, status: "Not Connected", detail: "Provider is not connected" }
    const connected = row.status === "connected" || row.status === "active"
    if (!connected) {
      const requiresConfiguration =
        row.dashboard_status === "provider_unavailable" ||
        row.dashboard_status === "address_needs_verification" ||
        Boolean(row.readiness?.reason)
      return {
        id,
        label,
        status: requiresConfiguration ? "Requires Configuration" : "Not Connected",
        detail: row.readiness?.reason || "Provider is not connected"
      }
    }
    if (!row.enabled) return { id, label, status: "Disabled", detail: "Provider connected; payments disabled" }
    if (row.readiness && !row.readiness.ready) {
      return {
        id,
        label,
        status: "Requires Configuration",
        detail: row.readiness.reason || "Provider permissions or configuration are incomplete"
      }
    }
    return { id, label, status: "Connected", detail: "Provider connected and enabled" }
  })
}

function hasNwcConnection(row?: ProviderRow | null): boolean {
  if (!row) return false
  const status = String(row.status || "").toLowerCase().trim()
  return status === "connected" || status === "active"
}

function getLightningCapabilities() {
  const metadata = getProviderMetadata(SPEED_PROVIDER_NAME) || getProviderMetadata("lightning_nwc")
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
  // This prevents nwc_uri or other raw internal credentials from ever reaching the UI.
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
  const platformStatus = getPineTreeSpeedConfigStatus()
  if (speedRow && (speedRow.status === "connected" || speedRow.status === "active")) {
    const rawCreds = speedRow.credentials || {}
    const hasMerchantSpeedAccount = Boolean(String(rawCreds.speed_account_id || "").trim())
    const readyForPayments = platformStatus.configured && hasMerchantSpeedAccount && Boolean(speedRow.enabled)
    const safeSpeedCredentials: JsonObject = {
      mode: platformStatus.mode,
      account_id: (rawCreds.speed_account_id as string | null) ?? null,
      account_status: (rawCreds.speed_account_status as string | null) ?? null,
      payout_destination: (rawCreds.payout_destination as string | null) ?? null,
      payout_type: (rawCreds.payout_type as string | null) ?? null,
      setup_status:
        (rawCreds.setup_status as string | null) ?? "pending_speed_connect_confirmation",
      last_tested_at: (rawCreds.last_tested_at as string | null) ?? null,
      provider_model: "pine_tree_speed_platform",
      platform_configured: platformStatus.configured,
      platform_missing: platformStatus.missing,
      platform_account_id_configured: platformStatus.platformAccountIdConfigured,
      platform_webhook_secret_configured: platformStatus.webhookSecretConfigured,
      payment_processing_live: readyForPayments,
      settlement_path_status: readyForPayments ? "ready" : hasMerchantSpeedAccount ? platformStatus.settlementPathStatus : "missing_merchant_speed_account",
      dashboard_url: platformStatus.dashboardUrl
    }

    decoratedRows.push({
      provider: SPEED_PROVIDER_NAME,
      status: speedRow.status,
      enabled: readyForPayments,
      credentials: safeSpeedCredentials,
      dashboard_status: platformStatus.configured ? "connected" as LightningDashboardStatus : "provider_unavailable" as LightningDashboardStatus,
      capabilities: {
        supportsLightningInvoice: true,
        supportsFeeAtPaymentTime: true,
        supportsSplitSettlement: true,
        supportsWebhookConfirmation: platformStatus.webhookSecretConfigured
      },
      readiness: {
        ready: readyForPayments,
        missingPermissions: [
          ...platformStatus.missing,
          ...(hasMerchantSpeedAccount ? [] : ["speed_account_id"])
        ],
        reason: readyForPayments
          ? null
          : platformStatus.configured
            ? "Add the merchant Speed Account ID and pass the platform test before enabling Speed Lightning."
            : "PineTree Speed platform env is missing. Payment processing is not live."
      }
    })
  } else {
    decoratedRows.push({
      provider: SPEED_PROVIDER_NAME,
      status: platformStatus.configured ? "configured" : "missing_env",
      enabled: false,
      credentials: {
        mode: platformStatus.mode,
        provider_model: "pine_tree_speed_platform",
        platform_configured: platformStatus.configured,
        platform_missing: platformStatus.missing,
        platform_account_id_configured: platformStatus.platformAccountIdConfigured,
        platform_webhook_secret_configured: platformStatus.webhookSecretConfigured,
        payment_processing_live: false,
        settlement_path_status: platformStatus.configured ? "missing_merchant_speed_account" : platformStatus.settlementPathStatus,
        setup_status: "pending_speed_connect_confirmation",
        dashboard_url: platformStatus.dashboardUrl
      },
      dashboard_status: platformStatus.configured ? "connected" as LightningDashboardStatus : "provider_unavailable" as LightningDashboardStatus,
      capabilities: {
        supportsLightningInvoice: true,
        supportsFeeAtPaymentTime: true,
        supportsSplitSettlement: true,
        supportsWebhookConfirmation: platformStatus.webhookSecretConfigured
      },
      readiness: {
        ready: false,
        missingPermissions: [...platformStatus.missing, "speed_account_id"],
        reason: platformStatus.configured
          ? "Add the merchant Speed Account ID before enabling Speed Lightning."
          : "PineTree Speed platform env is missing. Payment processing is not live."
      }
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
    wallets: oneWalletPerRail((walletsRes.data || []) as WalletRow[]),
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

    const { data: existingRows, error: existingError } = await db
      .from("merchant_wallets")
      .select("id")
      .eq("merchant_id", merchantId)
      .eq("network", provider)

    if (existingError) {
      throw new Error(`Failed checking wallet row: ${existingError.message}`)
    }

    const existing = (existingRows || [])[0] || null

    if (existingRows && existingRows.length > 1) {
      const duplicateIds = existingRows.slice(1).map((row) => row.id)
      const { error: duplicateDeleteError } = await db
        .from("merchant_wallets")
        .delete()
        .in("id", duplicateIds)

      if (duplicateDeleteError) {
        throw new Error(`Failed enforcing one wallet per rail: ${duplicateDeleteError.message}`)
      }
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
