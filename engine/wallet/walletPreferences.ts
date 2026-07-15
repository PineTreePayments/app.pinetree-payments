import { resolveMerchantWalletProvider } from "./walletProviderResolution"
import { WalletApiRouteError } from "./walletErrors"
import { isSupportedWalletAsset, parseWalletAmountToBaseUnits } from "./walletMoney"
import type { PineTreeWalletPreferences } from "./walletTypes"
import {
  defaultWalletPreferences,
  getWalletPreferences as getStoredWalletPreferences,
  upsertWalletPreferences,
  type AutoPayoutSchedule,
  type AutoSwapStatus,
  type MerchantWalletPreferences,
  type UpdateWalletPreferencesInput as DbUpdateWalletPreferencesInput,
} from "@/database/merchantWalletPreferences"

function toPineTreeWalletPreferences(row: MerchantWalletPreferences): PineTreeWalletPreferences {
  return {
    autoPayoutEnabled: row.auto_payout_enabled,
    autoPayoutSchedule: row.auto_payout_schedule,
    autoPayoutDestination: row.auto_payout_destination,
    autoPayoutSourceAsset: row.auto_payout_source_asset,
    autoPayoutMinThresholdBaseUnits: row.auto_payout_min_threshold_base_units,
    autoPayoutRetainedBalanceBaseUnits: row.auto_payout_retained_balance_base_units,
    autoSwapEnabled: row.auto_swap_enabled,
    autoSwapSourceAsset: row.auto_swap_source_asset,
    autoSwapTargetAsset: row.auto_swap_target_asset,
    autoSwapStatus: row.auto_swap_status,
  }
}

export async function getWalletPreferences(merchantId: string): Promise<PineTreeWalletPreferences> {
  await resolveMerchantWalletProvider(merchantId)
  const existing = await getStoredWalletPreferences(merchantId)
  return toPineTreeWalletPreferences(existing ?? defaultWalletPreferences(merchantId))
}

export type UpdateWalletPreferencesInput = {
  autoPayoutEnabled?: boolean
  autoPayoutSchedule?: AutoPayoutSchedule
  autoPayoutDestination?: string | null
  autoPayoutSourceAsset?: string | null
  autoPayoutMinThresholdDecimal?: string | null
  autoPayoutRetainedBalanceDecimal?: string | null
  autoSwapEnabled?: boolean
  autoSwapSourceAsset?: string | null
  autoSwapTargetAsset?: string | null
  autoSwapMode?: string | null
}

function toBaseUnitsOrThrow(
  value: string | null | undefined,
  asset: string | null | undefined,
  field: string
): bigint | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value.trim() === "") return null
  const normalizedAsset = String(asset || "").trim().toUpperCase()
  if (!isSupportedWalletAsset(normalizedAsset)) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", `Select a source asset before setting ${field}.`)
  }
  const baseUnits = parseWalletAmountToBaseUnits(value, normalizedAsset)
  if (baseUnits === null) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", `Enter a valid ${field} amount.`)
  }
  return baseUnits
}

export async function updateWalletPreferences(
  merchantId: string,
  input: UpdateWalletPreferencesInput
): Promise<PineTreeWalletPreferences> {
  const { adapter, context } = await resolveMerchantWalletProvider(merchantId)

  if (input.autoPayoutDestination !== undefined && input.autoPayoutDestination !== null) {
    if (!input.autoPayoutDestination.trim()) {
      throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Automatic payout destination cannot be blank.")
    }
  }

  const existing = await getStoredWalletPreferences(merchantId)
  const effectiveSourceAsset =
    input.autoPayoutSourceAsset !== undefined ? input.autoPayoutSourceAsset : existing?.auto_payout_source_asset

  const dbInput: DbUpdateWalletPreferencesInput = {
    autoPayoutEnabled: input.autoPayoutEnabled,
    autoPayoutSchedule: input.autoPayoutSchedule,
    autoPayoutDestination: input.autoPayoutDestination,
    autoPayoutSourceAsset: input.autoPayoutSourceAsset,
    autoPayoutMinThresholdBaseUnits: toBaseUnitsOrThrow(
      input.autoPayoutMinThresholdDecimal,
      effectiveSourceAsset,
      "minimum balance threshold"
    ),
    autoPayoutRetainedBalanceBaseUnits: toBaseUnitsOrThrow(
      input.autoPayoutRetainedBalanceDecimal,
      effectiveSourceAsset,
      "retained balance"
    ),
    autoSwapEnabled: input.autoSwapEnabled,
    autoSwapSourceAsset: input.autoSwapSourceAsset,
    autoSwapTargetAsset: input.autoSwapTargetAsset,
    autoSwapMode: input.autoSwapMode,
  }

  // Automatic payouts/swaps are never reported "active" just because a
  // merchant flipped the toggle - PineTree only persists intent here. The
  // stored status always reflects the resolved provider's live capability,
  // never a false "active".
  const capabilities = await adapter.getCapabilities(context)
  const autoSwapStatus: AutoSwapStatus = !capabilities.automaticConversion
    ? "pending_provider_support"
    : (input.autoSwapEnabled ?? existing?.auto_swap_enabled)
      ? "active"
      : "pending_provider_support"

  const saved = await upsertWalletPreferences(merchantId, dbInput, autoSwapStatus)
  return toPineTreeWalletPreferences(saved)
}
