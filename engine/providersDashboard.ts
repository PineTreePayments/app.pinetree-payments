import { supabaseAdmin, supabase } from "@/database"
import { refreshWalletBalancesEngine } from "./walletOverview"

const db = supabaseAdmin || supabase

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

type ProviderRow = {
  provider: string
  status: string
  enabled: boolean
  credentials?: JsonObject | null
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
    providers: providersRes.data || [],
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
}) {
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
          wallet_type: walletType || null,
          status: "connected"
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
          wallet_type: walletType || null,
          status: "connected"
        })

      if (error) {
        throw new Error(`Failed inserting wallet: ${error.message}`)
      }
    }

    credentials = {
      wallet: address,
      wallet_type: walletType || null
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
        enabled: true,
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
