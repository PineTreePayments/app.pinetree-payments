import { supabaseAdmin, supabase } from "@/database"
import { refreshWalletBalancesEngine } from "./walletOverview"
import { loadProviders } from "./loadProviders"
import { getProviderMetadata } from "@/providers/registry"
import { getLightningNwcReadiness, SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getPineTreeSpeedConfigStatus } from "@/providers/lightning/speedClient"
import {
  canCardProviderProcessPayments,
  isCardProviderSetupReady,
  isStripeConnectReady
} from "@/providers/cardProviderReadiness"
import {
  buildPineTreeRailReadiness,
  getPineTreeRailReadinessDiagnostics,
  type PineTreeRailReadinessMap
} from "@/lib/pinetreeRailReadiness"
import { assertMerchantBusinessProfileComplete, getMerchantBusinessProfile, type MerchantBusinessProfile } from "./businessProfile"

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
  cardReadiness?: {
    connected: boolean
    enabled: boolean
    readyForPayments: boolean
    onboardingStatus: "not_started" | "pending" | "complete" | "denied"
    unavailableReason: string | null
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
  railReadiness: PineTreeRailReadinessMap
  pineTreeWalletProfile: {
    baseAddressPresent: boolean
    solanaAddressPresent: boolean
    bitcoinAddressPresent: boolean
  } | null
  settings: {
    smart_routing_enabled: boolean
    auto_conversion_enabled: boolean
  }
  businessProfile: Pick<MerchantBusinessProfile, "profile_status" | "missing_fields">
}

export type OverviewRailReadiness = {
  id: string
  label: string
  status: "Connected" | "Not Connected" | "Requires Configuration"
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
  data: Pick<ProvidersDashboardData, "providers" | "wallets"> & Partial<Pick<ProvidersDashboardData, "railReadiness">>
): OverviewRailReadiness[] {
  const provider = (id: string) => data.providers.find((row) => row.provider === id)
  const wallet = (id: string) => data.wallets.find((row) => row.network === id)

  return OVERVIEW_RAILS.map(({ id, label }) => {
    if (id === "solana" || id === "base") {
      const readiness = data.railReadiness?.[id]
      if (readiness) {
        if (readiness.paymentReady) {
          return { id, label, status: "Connected", detail: "PineTree Wallet settlement address ready" }
        }
        if (readiness.enabled) {
          return { id, label, status: "Requires Configuration", detail: "PineTree Wallet address missing" }
        }
        return { id, label, status: "Not Connected", detail: "Payment rail off" }
      }
      const row = provider(id)
      const connectedWallet = wallet(id)
      if (!connectedWallet) {
        return { id, label, status: "Not Connected", detail: `Connect a ${label} wallet` }
      }
      if (row?.enabled === false) {
        return { id, label, status: "Not Connected", detail: "Wallet connected; payment rail off" }
      }
      return { id, label, status: "Connected", detail: "Merchant wallet connected" }
    }

    if (id === "lightning") {
      const readiness = data.railReadiness?.bitcoin_lightning
      if (readiness) {
        if (readiness.paymentReady) {
          return {
            id,
            label,
            status: "Connected",
            detail: "Speed Lightning payment account ready"
          }
        }
        if (readiness.enabled) {
          return {
            id,
            label,
            status: "Requires Configuration",
            detail: "Speed Lightning setup pending"
          }
        }
        return { id, label, status: "Not Connected", detail: "Bitcoin Lightning rail off" }
      }
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
          detail: "PineTree Wallet managed rail ready"
        }
      }
      if (speed?.enabled === false || nwc?.enabled === false) {
        const hasConnection = speed?.dashboard_status === "connected" || nwc?.dashboard_status === "connected"
        if (hasConnection) return { id, label, status: "Not Connected", detail: "Bitcoin Lightning rail off" }
      }
      const reason = speed?.readiness?.reason || nwc?.readiness?.reason
      return {
        id,
        label,
        status: reason ? "Requires Configuration" : "Not Connected",
        detail: reason || "PineTree Wallet setup pending"
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
    if (!row.enabled) return { id, label, status: "Not Connected", detail: "Provider connected; payments off" }
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

function getApplicationCardOnboardingStatus(row: ProviderRow): NonNullable<ProviderRow["cardReadiness"]>["onboardingStatus"] {
  const credentials = row.credentials || {}
  const providerId = String(row.provider || "").trim().toLowerCase()
  const applicationStatus = String(credentials.application_status || row.status || "").trim().toLowerCase()

  if (applicationStatus === "denied" || applicationStatus === "declined" || applicationStatus === "rejected") {
    return "denied"
  }

  if (providerId === "shift4") {
    if (isCardProviderSetupReady(row)) return "complete"
  } else if (providerId === "fluidpay") {
    if (isCardProviderSetupReady(row)) return "complete"
  }

  if (
    applicationStatus === "pending" ||
    applicationStatus === "setup_started" ||
    Boolean(credentials.setup_started_at || credentials.setup_submitted_at || credentials.setup_returned_at)
  ) {
    return "pending"
  }

  return "not_started"
}

function getStripeOnboardingStatus(row: ProviderRow): NonNullable<ProviderRow["cardReadiness"]>["onboardingStatus"] {
  const credentials = row.credentials || {}
  if (isCardProviderSetupReady(row)) return "complete"
  if (credentials.details_submitted === true || Boolean(String(credentials.stripe_account_id || "").trim())) {
    return "pending"
  }
  return "not_started"
}

function buildCardReadiness(row: ProviderRow): NonNullable<ProviderRow["cardReadiness"]> {
  const providerId = String(row.provider || "").trim().toLowerCase()
  const onboardingStatus = providerId === "stripe"
    ? getStripeOnboardingStatus(row)
    : getApplicationCardOnboardingStatus(row)
  const readyForPayments = isCardProviderSetupReady(row)
  const routingReady = providerId === "stripe"
    ? isStripeConnectReady(row)
    : canCardProviderProcessPayments(row)
  const connected = onboardingStatus === "complete"

  return {
    connected,
    enabled: row.enabled !== false,
    readyForPayments,
    onboardingStatus,
    unavailableReason: readyForPayments
      ? routingReady
        ? null
        : "Payment routing is disabled."
      : onboardingStatus === "pending"
        ? "Provider setup is pending."
        : onboardingStatus === "denied"
          ? "Provider setup was denied."
          : "Provider setup has not started."
  }
}

function sanitizeCardProviderRow(row: ProviderRow): ProviderRow {
  return {
    ...row,
    credentials: {
      provider_model: String(row.credentials?.provider_model || "")
    },
    cardReadiness: buildCardReadiness(row)
  }
}

function decorateProviderRows(rows: ProviderRow[]): ProviderRow[] {
  const providersByKey = new Map(rows.map((row) => [row.provider, row]))
  const nwcRow = providersByKey.get("lightning_nwc")
  const speedRow = providersByKey.get(SPEED_PROVIDER_NAME)
  const lightningCapabilities = getLightningCapabilities()
  const lightningStatus = getLightningDashboardStatus(nwcRow)

  // Exclude raw internal rows — sanitized rows are synthesized below.
  // This prevents nwc_uri or other raw internal credentials from ever reaching the UI.
  const decoratedRows: ProviderRow[] = rows
    .filter(
      (row) =>
        row.provider !== "lightning" &&
        row.provider !== "lightning_nwc" &&
        row.provider !== SPEED_PROVIDER_NAME
    )
    .map((row) => {
      if (row.provider === "stripe") {
        return sanitizeCardProviderRow(row)
      }

      if (row.provider === "fluidpay") {
        return sanitizeCardProviderRow(row)
      }

      if (row.provider === "shift4") return sanitizeCardProviderRow(row)

      return row
    })

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
        reason: "Bitcoin Lightning is managed through PineTree Wallet."
      }
    })
  }

  // ── Speed Lightning (Recommended) ─────────────────────────────────────────
  const platformStatus = getPineTreeSpeedConfigStatus()
  if (speedRow && (speedRow.status === "connected" || speedRow.status === "active")) {
    const rawCreds = speedRow.credentials || {}
    const hasMerchantSpeedAccount = Boolean(String(rawCreds.speed_account_id || "").trim())
    const readyForPayments = platformStatus.configured && hasMerchantSpeedAccount && Boolean(speedRow.enabled)
    const merchantEnabled = Boolean(speedRow.enabled)
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
      // Reflect the merchant's toggle choice, not payment-system readiness.
      // readiness.ready captures whether payments are actually live.
      enabled: merchantEnabled,
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

  const [providersRes, walletsRes, pineTreeWalletProfile, lightningProfile, settings, businessProfile] = await Promise.all([
    db.from("merchant_providers").select("*").eq("merchant_id", merchantId),
    db.from("merchant_wallets").select("*").eq("merchant_id", merchantId),
    getPineTreeWalletProfile(merchantId),
    import("@/database/merchantLightningProfiles").then((mod) => mod.getMerchantLightningProfile(merchantId)),
    ensureMerchantSettings(merchantId),
    getMerchantBusinessProfile(merchantId)
  ])

  if (providersRes.error) {
    throw new Error(`Failed to load providers: ${providersRes.error.message}`)
  }

  if (walletsRes.error) {
    throw new Error(`Failed to load wallets: ${walletsRes.error.message}`)
  }

  const providerRows = (providersRes.data || []) as ProviderRow[]
  const speedProvider = providerRows.find((row) => row.provider === SPEED_PROVIDER_NAME)
  const speedCredentials = (speedProvider?.credentials || {}) as JsonObject
  const speedConfig = getPineTreeSpeedConfigStatus()
  const speedAccountReady = Boolean(
    lightningProfile?.status === "ready" ||
    (
      String(speedCredentials.speed_account_id || speedCredentials.account_id || "").trim() &&
      (String(speedCredentials.setup_status || "").trim() === "ready" ||
        String(speedCredentials.setup_status || "").trim() === "ready_for_payments")
    )
  )
  const railReadiness = buildPineTreeRailReadiness({
    providers: providerRows,
    walletProfile: pineTreeWalletProfile,
    speed: {
      configured: speedConfig.configured,
      accountReady: speedAccountReady,
      payoutReady: Boolean(speedAccountReady && pineTreeWalletProfile?.btc_payout_enabled),
      status: lightningProfile?.status || String(speedCredentials.setup_status || speedProvider?.status || "")
    },
    businessProfileComplete: businessProfile.profile_status === "complete"
  })

  if (process.env.NODE_ENV !== "production" || process.env.PINETREE_RAIL_READINESS_DEBUG === "true") {
    console.info("[pinetree-rail-readiness] providers-dashboard", {
      merchantId,
      ...getPineTreeRailReadinessDiagnostics(railReadiness)
    })
  }

  return {
    providers: decorateProviderRows(providerRows),
    wallets: oneWalletPerRail((walletsRes.data || []) as WalletRow[]),
    railReadiness,
    pineTreeWalletProfile: pineTreeWalletProfile
      ? {
          baseAddressPresent: Boolean(pineTreeWalletProfile.base_address),
          solanaAddressPresent: Boolean(pineTreeWalletProfile.solana_address),
          bitcoinAddressPresent: railReadiness.bitcoin_lightning.walletProvisioned
        }
      : null,
    settings,
    businessProfile: {
      profile_status: businessProfile.profile_status,
      missing_fields: businessProfile.missing_fields,
    }
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

  if (enabled) {
    await assertMerchantBusinessProfileComplete(merchantId)

    if (provider === "stripe" || provider === "shift4" || provider === "fluidpay") {
      const { data: cardProvider, error: cardProviderError } = await db
        .from("merchant_providers")
        .select("provider,status,enabled,credentials")
        .eq("merchant_id", merchantId)
        .eq("provider", provider)
        .maybeSingle()

      if (cardProviderError) {
        throw new Error(`Failed checking ${provider} readiness: ${cardProviderError.message}`)
      }
      if (!cardProvider || !isCardProviderSetupReady(cardProvider)) {
        throw new Error(`Complete ${provider === "fluidpay" ? "FluidPay" : provider === "shift4" ? "Shift4" : "Stripe"} setup before enabling payment routing.`)
      }
    }
  }

  const canonicalWalletMode =
    process.env.PINE_TREE_WALLET_CANONICAL === "true" ||
    process.env.NEXT_PUBLIC_PINE_TREE_WALLET_CANONICAL === "true"

  if (provider === "lightning" && canonicalWalletMode) {
    const { data: existingSpeed, error: existingSpeedError } = await db
      .from("merchant_providers")
      .select("credentials,status")
      .eq("merchant_id", merchantId)
      .eq("provider", SPEED_PROVIDER_NAME)
      .maybeSingle()

    if (existingSpeedError) {
      throw new Error(`Failed checking Speed Lightning provider: ${existingSpeedError.message}`)
    }

    const existingCredentials = (existingSpeed?.credentials || {}) as JsonObject
    const { error } = await db
      .from("merchant_providers")
      .upsert(
        {
          merchant_id: merchantId,
          provider: SPEED_PROVIDER_NAME,
          status: String(existingSpeed?.status || "connected"),
          enabled,
          credentials: {
            ...existingCredentials,
            provider_model: "pine_tree_speed_platform",
            payout_destination: "pinetree_wallet",
            setup_source: "pinetree_wallet"
          }
        },
        { onConflict: "merchant_id,provider" }
      )

    if (error) {
      throw new Error(`Failed to toggle provider: ${error.message}`)
    }

    return
  }

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

  // For solana/base in canonical wallet mode the provider row may not yet exist
  // (if rail sync hasn't run). Use upsert to avoid a silent no-op.
  if (provider === "solana" || provider === "base") {
    const { data: existingRow } = await db
      .from("merchant_providers")
      .select("status, credentials")
      .eq("merchant_id", merchantId)
      .eq("provider", targetProvider)
      .maybeSingle()

    const { error } = await db
      .from("merchant_providers")
      .upsert(
        {
          merchant_id: merchantId,
          provider: targetProvider,
          status: (existingRow?.status as string | null) || "connected",
          credentials: (existingRow?.credentials as JsonObject | null) || {},
          enabled
        },
        { onConflict: "merchant_id,provider" }
      )

    if (error) {
      throw new Error(`Failed to toggle provider: ${error.message}`)
    }
    return
  }

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
  providerSetup?: {
    account_reference?: string
    notes?: string
  }
}) {
  await loadProviders()
  const { merchantId, provider, walletAddress, walletType, apiKey, providerSetup } = args

  let credentials: JsonObject = {}
  let status = "connected"
  let enabled = true

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
    const { data: existingProvider, error: existingProviderError } = await db
      .from("merchant_providers")
      .select("enabled")
      .eq("merchant_id", merchantId)
      .eq("provider", provider)
      .maybeSingle()

    if (existingProviderError) {
      throw new Error(`Failed loading provider enabled state: ${existingProviderError.message}`)
    }

    enabled = existingProvider ? Boolean(existingProvider.enabled) : true
  } else if (provider === SPEED_PROVIDER_NAME) {
    const { data: existingSpeed, error: existingSpeedError } = await db
      .from("merchant_providers")
      .select("credentials,status,enabled")
      .eq("merchant_id", merchantId)
      .eq("provider", SPEED_PROVIDER_NAME)
      .maybeSingle()

    if (existingSpeedError) {
      throw new Error(`Failed loading Speed Lightning provider: ${existingSpeedError.message}`)
    }

    const existingCredentials = (existingSpeed?.credentials || {}) as JsonObject
    status = String(existingSpeed?.status || "connected")
    enabled = existingSpeed ? Boolean(existingSpeed.enabled) : true
    credentials = {
      ...existingCredentials,
      provider_model: "pine_tree_speed_platform",
      payout_destination: "pinetree_wallet",
      setup_source: "pinetree_wallet"
    }
  } else if (provider === "lightning") {
    // NWC Lightning is connected via /api/wallets/lightning/connect — not this path.
    throw new Error("Use the Lightning wallet connection flow to connect a Bitcoin Lightning wallet.")
  } else if (provider === "shift4") {
    const accountReference = String(providerSetup?.account_reference || "").trim()
    if (!accountReference) {
      throw new Error("Shift4 Account Reference is required")
    }

    const { data: existingShift4, error: existingShift4Error } = await db
      .from("merchant_providers")
      .select("credentials,status,enabled")
      .eq("merchant_id", merchantId)
      .eq("provider", "shift4")
      .maybeSingle()

    if (existingShift4Error) {
      throw new Error(`Failed loading Shift4 provider setup: ${existingShift4Error.message}`)
    }

    const existingCredentials = (existingShift4?.credentials || {}) as JsonObject
    status = String(existingShift4?.status || "pending")
    enabled = existingShift4 ? Boolean(existingShift4.enabled) : false
    credentials = {
      ...existingCredentials,
      account_reference: accountReference.slice(0, 200),
      notes: String(providerSetup?.notes || "").trim().slice(0, 2000),
      provider_model: "shift4_merchant_account"
    }
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
        status,
        enabled,
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
