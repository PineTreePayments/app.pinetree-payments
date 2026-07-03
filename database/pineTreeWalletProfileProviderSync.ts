import { supabase, supabaseAdmin } from "./supabase"
import type { PineTreeWalletProfile } from "./pineTreeWalletProfiles"

const db = supabaseAdmin || supabase

type ProviderSyncResult = {
  provider: "base" | "solana" | "lightning_speed"
  status: "upserted" | "skipped"
  reason?: string
}

function buildDynamicProviderCredentials(
  provider: "base" | "solana",
  address: string
): Record<string, string> {
  return {
    setup_source: "pinetree_wallet",
    settlement: "pinetree_wallet",
    address_source: "dynamic",
    wallet: address,
    wallet_type: "PINETREE",
    ...(provider === "base" ? { base_address: address } : { solana_address: address }),
  }
}

async function upsertDynamicProvider(
  merchantId: string,
  provider: "base" | "solana",
  address: string,
  now: string
): Promise<void> {
  const { error } = await db
    .from("merchant_providers")
    .upsert(
      {
        merchant_id: merchantId,
        provider,
        status: "connected",
        enabled: true,
        credentials: buildDynamicProviderCredentials(provider, address),
        updated_at: now,
      },
      { onConflict: "merchant_id,provider" }
    )

  if (error) {
    throw new Error(`Failed syncing ${provider} provider row: ${error.message}`)
  }
}

async function ensurePendingLightningProvider(merchantId: string, now: string): Promise<ProviderSyncResult> {
  const { data: existing, error: existingError } = await db
    .from("merchant_providers")
    .select("id")
    .eq("merchant_id", merchantId)
    .eq("provider", "lightning_speed")
    .maybeSingle()

  if (existingError) {
    throw new Error(`Failed checking Lightning provider row: ${existingError.message}`)
  }

  if (existing?.id) {
    return {
      provider: "lightning_speed",
      status: "skipped",
      reason: "Lightning provider row already exists",
    }
  }

  const { error } = await db
    .from("merchant_providers")
    .upsert(
      {
        merchant_id: merchantId,
        provider: "lightning_speed",
        status: "pending",
        enabled: false,
        credentials: {
          setup_source: "pinetree_wallet",
          settlement: "pinetree_wallet",
          address_source: "speed",
        },
        updated_at: now,
      },
      { onConflict: "merchant_id,provider" }
    )

  if (error) {
    throw new Error(`Failed syncing Lightning provider row: ${error.message}`)
  }

  return { provider: "lightning_speed", status: "upserted" }
}

export async function syncPineTreeWalletProfileProviders(
  profile: PineTreeWalletProfile
): Promise<ProviderSyncResult[]> {
  const merchantId = profile.merchant_id
  const now = new Date().toISOString()
  const results: ProviderSyncResult[] = []
  const baseAddress = String(profile.base_address || "").trim()
  const solanaAddress = String(profile.solana_address || "").trim()

  if (baseAddress) {
    await upsertDynamicProvider(merchantId, "base", baseAddress, now)
    results.push({ provider: "base", status: "upserted" })
  } else {
    results.push({ provider: "base", status: "skipped", reason: "Missing Base address" })
  }

  if (solanaAddress) {
    await upsertDynamicProvider(merchantId, "solana", solanaAddress, now)
    results.push({ provider: "solana", status: "upserted" })
  } else {
    results.push({ provider: "solana", status: "skipped", reason: "Missing Solana address" })
  }

  results.push(await ensurePendingLightningProvider(merchantId, now))

  return results
}
