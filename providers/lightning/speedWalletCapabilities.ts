/**
 * Confirmed Speed Custom Connect wallet capabilities.
 *
 * PineTree authenticates with its platform key and scopes merchant requests
 * with `speed-account: <connected_account_id>`. Balance reads, transaction
 * lists, and user-triggered Instant Send withdrawals are supported. Speed
 * does not expose AutoPayout or AutoSwap APIs; those capabilities must remain
 * false and must never be simulated with background transfers.
 */

import { getPineTreeSpeedConfigStatus } from "./speedClient"

export type SpeedWalletCapabilityKey =
  | "balances"
  | "transactions"
  | "transfers"
  | "withdrawals"
  | "payouts"
  | "payoutStatus"
  | "manualSwap"
  | "automaticPayouts"
  | "automaticSwap"

export type SpeedWalletCapabilities = Record<SpeedWalletCapabilityKey, boolean>

export type SpeedWalletCapabilityReason =
  | "speed_connect_disabled"
  | "speed_not_configured"
  | "provider_not_supported"
  | "available"

export type SpeedWalletCapabilityDetail = {
  available: boolean
  reason: SpeedWalletCapabilityReason
}

export type SpeedWalletCapabilitiesResult = {
  capabilities: SpeedWalletCapabilities
  details: Record<SpeedWalletCapabilityKey, SpeedWalletCapabilityDetail>
  accountScopingConfirmed: true
  speedConnectEnabled: boolean
  speedConfigured: boolean
}

function isSpeedConnectEnabled(): boolean {
  return String(process.env.SPEED_CONNECT_ENABLED || "").trim() === "true"
}

export function isSpeedWalletAccountScopingConfirmed(): true {
  return true
}

export function getSpeedWalletCapabilities(): SpeedWalletCapabilitiesResult {
  const speedConfigured = getPineTreeSpeedConfigStatus().configured
  const speedConnectEnabled = isSpeedConnectEnabled()
  const accountReady = speedConfigured && speedConnectEnabled
  const supported = new Set<SpeedWalletCapabilityKey>([
    "balances",
    "transactions",
    "withdrawals",
    "payoutStatus",
  ])
  const keys: SpeedWalletCapabilityKey[] = [
    "balances",
    "transactions",
    "transfers",
    "withdrawals",
    "payouts",
    "payoutStatus",
    "manualSwap",
    "automaticPayouts",
    "automaticSwap",
  ]
  const details = {} as Record<SpeedWalletCapabilityKey, SpeedWalletCapabilityDetail>
  const capabilities = {} as SpeedWalletCapabilities

  for (const key of keys) {
    const reason: SpeedWalletCapabilityReason = !speedConfigured
      ? "speed_not_configured"
      : !speedConnectEnabled
        ? "speed_connect_disabled"
        : supported.has(key)
          ? "available"
          : "provider_not_supported"
    details[key] = { available: reason === "available", reason }
    capabilities[key] = accountReady && supported.has(key)
  }

  return {
    capabilities,
    details,
    accountScopingConfirmed: true,
    speedConnectEnabled,
    speedConfigured,
  }
}

export function getSpeedWalletCapabilityDetail(key: SpeedWalletCapabilityKey): SpeedWalletCapabilityDetail {
  return getSpeedWalletCapabilities().details[key]
}
