import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "merchant_wallet_preferences"

export type AutoPayoutSchedule = "disabled" | "daily" | "weekly" | "threshold"
export type AutoSwapStatus = "active" | "pending_provider_support" | "unavailable"

export type MerchantWalletPreferences = {
  id: string
  merchant_id: string
  auto_payout_enabled: boolean
  auto_payout_schedule: AutoPayoutSchedule
  auto_payout_destination: string | null
  auto_payout_source_asset: string | null
  auto_payout_min_threshold_base_units: string | null
  auto_payout_retained_balance_base_units: string | null
  auto_payout_last_attempted_at: string | null
  auto_payout_next_eligible_at: string | null
  auto_payout_failure_state: string | null
  auto_swap_enabled: boolean
  auto_swap_source_asset: string | null
  auto_swap_target_asset: string | null
  auto_swap_mode: string | null
  auto_swap_status: AutoSwapStatus
  created_at: string
  updated_at: string
}

const DEFAULTS: Omit<MerchantWalletPreferences, "id" | "merchant_id" | "created_at" | "updated_at"> = {
  auto_payout_enabled: false,
  auto_payout_schedule: "disabled",
  auto_payout_destination: null,
  auto_payout_source_asset: null,
  auto_payout_min_threshold_base_units: null,
  auto_payout_retained_balance_base_units: null,
  auto_payout_last_attempted_at: null,
  auto_payout_next_eligible_at: null,
  auto_payout_failure_state: null,
  auto_swap_enabled: false,
  auto_swap_source_asset: null,
  auto_swap_target_asset: null,
  auto_swap_mode: null,
  auto_swap_status: "pending_provider_support",
}

export function defaultWalletPreferences(merchantId: string): MerchantWalletPreferences {
  const now = new Date().toISOString()
  return {
    id: "",
    merchant_id: merchantId,
    ...DEFAULTS,
    created_at: now,
    updated_at: now,
  }
}

export async function getWalletPreferences(merchantId: string): Promise<MerchantWalletPreferences | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load wallet preferences: ${error.message}`)
  return (data ?? null) as MerchantWalletPreferences | null
}

export type UpdateWalletPreferencesInput = {
  autoPayoutEnabled?: boolean
  autoPayoutSchedule?: AutoPayoutSchedule
  autoPayoutDestination?: string | null
  autoPayoutSourceAsset?: string | null
  autoPayoutMinThresholdBaseUnits?: bigint | null
  autoPayoutRetainedBalanceBaseUnits?: bigint | null
  autoSwapEnabled?: boolean
  autoSwapSourceAsset?: string | null
  autoSwapTargetAsset?: string | null
  autoSwapMode?: string | null
}

export async function upsertWalletPreferences(
  merchantId: string,
  input: UpdateWalletPreferencesInput,
  // Automatic swap can never be reported "active" from this module alone -
  // the caller (engine/wallet layer) must pass the current provider
  // capability so the stored status always reflects reality, never optimism.
  autoSwapStatus: AutoSwapStatus
): Promise<MerchantWalletPreferences> {
  const existing = await getWalletPreferences(merchantId)

  const row: Record<string, unknown> = {
    merchant_id: merchantId,
    auto_payout_enabled: input.autoPayoutEnabled ?? existing?.auto_payout_enabled ?? DEFAULTS.auto_payout_enabled,
    auto_payout_schedule: input.autoPayoutSchedule ?? existing?.auto_payout_schedule ?? DEFAULTS.auto_payout_schedule,
    auto_payout_destination:
      input.autoPayoutDestination !== undefined ? input.autoPayoutDestination : existing?.auto_payout_destination ?? null,
    auto_payout_source_asset:
      input.autoPayoutSourceAsset !== undefined ? input.autoPayoutSourceAsset : existing?.auto_payout_source_asset ?? null,
    auto_payout_min_threshold_base_units:
      input.autoPayoutMinThresholdBaseUnits !== undefined
        ? input.autoPayoutMinThresholdBaseUnits != null
          ? input.autoPayoutMinThresholdBaseUnits.toString()
          : null
        : existing?.auto_payout_min_threshold_base_units ?? null,
    auto_payout_retained_balance_base_units:
      input.autoPayoutRetainedBalanceBaseUnits !== undefined
        ? input.autoPayoutRetainedBalanceBaseUnits != null
          ? input.autoPayoutRetainedBalanceBaseUnits.toString()
          : null
        : existing?.auto_payout_retained_balance_base_units ?? null,
    auto_swap_enabled: input.autoSwapEnabled ?? existing?.auto_swap_enabled ?? DEFAULTS.auto_swap_enabled,
    auto_swap_source_asset:
      input.autoSwapSourceAsset !== undefined ? input.autoSwapSourceAsset : existing?.auto_swap_source_asset ?? null,
    auto_swap_target_asset:
      input.autoSwapTargetAsset !== undefined ? input.autoSwapTargetAsset : existing?.auto_swap_target_asset ?? null,
    auto_swap_mode: input.autoSwapMode !== undefined ? input.autoSwapMode : existing?.auto_swap_mode ?? null,
    auto_swap_status: autoSwapStatus,
  }

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "merchant_id" })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to save wallet preferences: ${error?.message ?? "unknown error"}`)
  }
  return data as MerchantWalletPreferences
}
