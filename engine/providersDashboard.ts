import { supabaseAdmin, supabase } from "@/database"
import { refreshWalletBalancesEngine } from "./walletOverview"
import { loadProviders } from "./loadProviders"
import { getProviderMetadata, isProviderHealthy } from "./providerRegistry"
import { verifyLightningAddress } from "@/providers/lightning/verifyLightningAddress"

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

const LIGHTNING_PROVIDER_ERROR =
  "Bitcoin Lightning requires a Speed Account ID, a verified BTC Payment Address, and a configured Speed platform."

// Lightning Address format: user@domain.tld (same RFC as email user@host)
function isValidLightningAddress(address: string): boolean {
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(address.trim())
}

function hasLightningAddress(row?: ProviderRow | null): boolean {
  const address = String(row?.credentials?.lightning_address || "").trim()
  return Boolean(address)
}

function hasSpeedAccountId(row?: ProviderRow | null): boolean {
  const accountId = String(row?.credentials?.speed_account_id || "").trim()
  return Boolean(accountId)
}

function hasPaymentAddressId(row?: ProviderRow | null): boolean {
  const paymentAddressId = String(row?.credentials?.payment_address_id || "").trim()
  return Boolean(paymentAddressId)
}

function isLightningAddressVerified(row?: ProviderRow | null): boolean {
  return Boolean(
    row?.credentials?.lightning_address &&
    row?.credentials?.lightning_address_verified === true
  )
}

function isSpeedMerchantAccountModel(row?: ProviderRow | null): boolean {
  return String(row?.credentials?.provider_model || "").trim() === "speed_merchant_account"
}

function getLightningCapabilities() {
  const metadata = getProviderMetadata("lightning")
  const capabilities = metadata?.capabilities

  return {
    supportsLightningInvoice: Boolean(capabilities?.supportsLightningInvoice),
    supportsFeeAtPaymentTime: Boolean(capabilities?.supportsFeeAtPaymentTime),
    supportsSplitSettlement: Boolean(capabilities?.supportsSplitSettlement),
    supportsWebhookConfirmation: Boolean(capabilities?.supportsWebhookConfirmation)
  }
}

function lightningCapabilityRequirementsPass(): boolean {
  const capabilities = getLightningCapabilities()

  return Boolean(
    capabilities.supportsLightningInvoice &&
    capabilities.supportsFeeAtPaymentTime &&
    capabilities.supportsSplitSettlement &&
    capabilities.supportsWebhookConfirmation &&
    isProviderHealthy("lightning")
  )
}

function getLightningDashboardStatus(row?: ProviderRow | null): LightningDashboardStatus {
  if (!hasSpeedAccountId(row) || !hasLightningAddress(row) || !hasPaymentAddressId(row)) return "not_configured"
  if (!isLightningAddressVerified(row)) return "address_needs_verification"
  if (!isSpeedMerchantAccountModel(row)) return "provider_unavailable"
  if (!lightningCapabilityRequirementsPass()) return "provider_unavailable"
  return "connected"
}

function decorateProviderRows(rows: ProviderRow[]): ProviderRow[] {
  const providersByKey = new Map(rows.map((row) => [row.provider, row]))
  const lightning = providersByKey.get("lightning")
  const lightningCapabilities = getLightningCapabilities()
  const lightningStatus = getLightningDashboardStatus(lightning)

  const decoratedRows = rows.map((row) => {
    if (row.provider !== "lightning") return row

    return {
      ...row,
      enabled: lightningStatus === "connected" ? Boolean(row.enabled) : false,
      dashboard_status: lightningStatus,
      capabilities: lightningCapabilities
    }
  })

  if (!providersByKey.has("lightning")) {
    decoratedRows.push({
      provider: "lightning",
      status: "disconnected",
      enabled: false,
      credentials: {},
      dashboard_status: "not_configured" as LightningDashboardStatus,
      capabilities: lightningCapabilities
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
      .select("provider,status,enabled,credentials")
      .eq("merchant_id", merchantId)
      .eq("provider", provider)
      .maybeSingle()

    if (lookupError) {
      throw new Error(`Failed checking provider: ${lookupError.message}`)
    }

    const row = data as ProviderRow | null
    if (!hasSpeedAccountId(row)) {
      throw new Error("A Speed Account ID is required before enabling Bitcoin Lightning.")
    }

    if (!isLightningAddressVerified(row)) {
      throw new Error(
        "A verified BTC Payment Address is required before enabling Bitcoin Lightning."
      )
    }

    if (!hasPaymentAddressId(row)) {
      throw new Error("A Payment Address ID is required before enabling Bitcoin Lightning.")
    }

    if (!isSpeedMerchantAccountModel(row)) {
      throw new Error("Bitcoin Lightning must use the Speed merchant-account provider model.")
    }

    if (!lightningCapabilityRequirementsPass()) {
      throw new Error(LIGHTNING_PROVIDER_ERROR)
    }
  }

  const { error } = await db
    .from("merchant_providers")
    .update({ enabled })
    .eq("merchant_id", merchantId)
    .eq("provider", provider)

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

  const { error: providerError } = await db
    .from("merchant_providers")
    .update({
      status: "disconnected",
      enabled: false,
      credentials: {}
    })
    .eq("merchant_id", merchantId)
    .eq("provider", provider)

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
  lightningAddress?: string
}) {
  await loadProviders()
  const { merchantId, provider, walletAddress, walletType, apiKey, lightningAddress } = args

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
    const speedAccountId = String(walletAddress || "").trim()
    const address = String(lightningAddress || "").trim()
    // app/api/providers forwards this existing field; for Lightning setup it
    // carries Speed's Payment Address ID, not a wallet type.
    const paymentAddressId = String(walletType || "").trim()

    if (!speedAccountId) {
      throw new Error("Speed Account ID is required.")
    }

    if (!address) {
      throw new Error("BTC Payment Address is required (e.g. username@tryspeed.com)")
    }

    if (!isValidLightningAddress(address)) {
      throw new Error(
        "Invalid BTC Payment Address format. Use username@tryspeed.com."
      )
    }

    if (!paymentAddressId) {
      throw new Error("Payment Address ID is required (e.g. pa_...).")
    }

    // LNURL-pay verification (LUD-16): fetch /.well-known/lnurlp/<user> and
    // confirm the response is a valid payRequest descriptor before marking verified.
    const verification = await verifyLightningAddress(address)

    if (!verification.verified) {
      throw new Error(
        "That BTC Payment Address could not be verified as a Lightning Address. Please check the address in Speed and try again."
      )
    }

    credentials = {
      speed_account_id: speedAccountId,
      lightning_address: address,
      payment_address_id: paymentAddressId,
      lightning_address_verified: true,
      verified_at: new Date().toISOString(),
      provider_model: "speed_merchant_account",
      lnurl_domain: verification.domain,
      lnurl_callback: verification.callbackUrl,
      verification_method: "lnurl-pay"
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
