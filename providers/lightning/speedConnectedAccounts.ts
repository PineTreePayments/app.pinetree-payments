/**
 * Server-side Speed connected-account provisioning helper.
 *
 * PineTree Wallet uses PineTree's Speed platform account for Lightning.
 * Merchants never provide Speed API keys, NWC strings, or Speed dashboard setup
 * details through the wallet setup UI.
 */

import { getPineTreeSpeedConfigStatus, type SpeedMode } from "./speedClient"

export type SpeedConnectedAccountReadiness = "pending" | "ready" | "needs_attention"

export type CreateOrLinkSpeedConnectedAccountInput = {
  merchant_id: string
  business_name?: string | null
  merchant_email?: string | null
  pinetree_reference_id: string
}

export type CreateOrLinkSpeedConnectedAccountResult = {
  speed_connected_account_id: string | null
  speed_connected_account_status: string
  raw_provider_status: string
  readiness: SpeedConnectedAccountReadiness
  mode: SpeedMode
  used_live_api: boolean
}

const READY_SPEED_ACCOUNT_STATUSES = new Set([
  "active",
  "approved",
  "connected",
  "enabled",
  "ready",
  "ready_for_payments",
  "verified",
])

const NEEDS_ATTENTION_SPEED_ACCOUNT_STATUSES = new Set([
  "action_required",
  "disabled",
  "failed",
  "incomplete",
  "rejected",
  "restricted",
  "suspended",
])

export function normalizeSpeedConnectedAccountReadiness(input: {
  speedConnectedAccountId?: string | null
  rawProviderStatus?: string | null
}): SpeedConnectedAccountReadiness {
  const status = String(input.rawProviderStatus || "").trim().toLowerCase()
  if (NEEDS_ATTENTION_SPEED_ACCOUNT_STATUSES.has(status)) return "needs_attention"
  if (input.speedConnectedAccountId && READY_SPEED_ACCOUNT_STATUSES.has(status)) return "ready"
  return "pending"
}

export async function createOrLinkSpeedConnectedAccountForMerchant(
  input: CreateOrLinkSpeedConnectedAccountInput
): Promise<CreateOrLinkSpeedConnectedAccountResult> {
  const config = getPineTreeSpeedConfigStatus()

  void input

  // TODO(speed-connect): Wire live Speed connected-account/sub-merchant creation
  // once Speed confirms the endpoint, payload shape, account status semantics, and
  // PineTree's platform credentials for connected-account provisioning.
  // Until then, return a safe pending result. Do not fake a ready Lightning rail.
  const rawStatus = config.configured
    ? "pending_speed_connect_endpoint_not_wired"
    : "pending_speed_platform_configuration"

  return {
    speed_connected_account_id: null,
    speed_connected_account_status: rawStatus,
    raw_provider_status: rawStatus,
    readiness: normalizeSpeedConnectedAccountReadiness({
      speedConnectedAccountId: null,
      rawProviderStatus: rawStatus,
    }),
    mode: config.mode,
    used_live_api: false,
  }
}
