/**
 * Speed Custom Connect wallet-management capability model.
 *
 * Research performed 2026-07-15 against Speed's official public API
 * reference (apidocs.tryspeed.com/reference/*) confirmed the following
 * endpoints exist and documented their request/response shape:
 *   - GET  /balances                  (balance-retrieve)
 *   - GET  /balance-transactions      (transaction-list)
 *   - POST /withdraw-requests         (withdraw-request-create)
 *   - GET  /withdraw-requests/{id}    (withdraw-request-retrieve)
 *   - POST /send                      (Instant Send / withdraw)
 *   - POST /balances/swap             (create-a-swap)
 *   - POST /balances/swap/quote       (swap-quote)
 *   - GET/POST/DELETE /connect...     (Connect: create/list/retrieve/remove
 *                                      connected accounts - already used by
 *                                      providers/lightning/speedConnectedAccounts.ts)
 *
 * NONE of the balance, transaction, withdraw-request, send, or swap pages
 * document any connected-account scoping mechanism - no header (no
 * `X-Speed-Account` or equivalent), no `account_id` query/body field, and no
 * mention of a separate per-connected-account API key. The only informal
 * confirmation of a scoping mechanism anywhere in this codebase is Speed's
 * verbal confirmation (see providers/lightning/speedInstantSend.ts) that
 * Instant Send accepts `X-Speed-Account`, and even that omits the exact
 * identifier format. Applying that same header to balances/transactions/
 * withdraw-requests/swap without Speed explicitly confirming it for each of
 * those endpoints would be exactly the kind of invented provider contract
 * this integration must not ship - see providers/lightning/speedWalletManagement.ts.
 *
 * Every capability below is therefore reported unavailable
 * (`PROVIDER_CAPABILITY_UNAVAILABLE`) until a human operator sets BOTH:
 *   1. the capability's own `SPEED_WALLET_<NAME>_ENABLED=true` flag, and
 *   2. `SPEED_WALLET_ACCOUNT_SCOPING_CONFIRMED=true` (a single global
 *      acknowledgement that Speed has confirmed a real scoping mechanism).
 * Flipping both flags is deliberately still not sufficient to make a live
 * call succeed - providers/lightning/speedWalletManagement.ts contains its
 * own unconditional chokepoint per operation, exactly mirroring
 * speedInstantSend.ts, because the request/response *translation* code for
 * an unconfirmed contract cannot be written safely regardless of
 * configuration. This file only decides what capabilities the UI/API may
 * advertise as configured; it never grants network access by itself.
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

export type SpeedWalletCapabilities = {
  balances: boolean
  transactions: boolean
  transfers: boolean
  withdrawals: boolean
  payouts: boolean
  payoutStatus: boolean
  manualSwap: boolean
  automaticPayouts: boolean
  automaticSwap: boolean
}

export type SpeedWalletCapabilityReason =
  | "speed_connect_disabled"
  | "speed_not_configured"
  | "scoping_not_confirmed"
  | "capability_flag_disabled"
  | "available"

export type SpeedWalletCapabilityDetail = {
  available: boolean
  reason: SpeedWalletCapabilityReason
}

export type SpeedWalletCapabilitiesResult = {
  capabilities: SpeedWalletCapabilities
  details: Record<SpeedWalletCapabilityKey, SpeedWalletCapabilityDetail>
  accountScopingConfirmed: boolean
  speedConnectEnabled: boolean
  speedConfigured: boolean
}

const CAPABILITY_ENV_FLAG: Record<SpeedWalletCapabilityKey, string> = {
  balances: "SPEED_WALLET_BALANCES_ENABLED",
  transactions: "SPEED_WALLET_TRANSACTIONS_ENABLED",
  transfers: "SPEED_WALLET_TRANSFERS_ENABLED",
  withdrawals: "SPEED_WALLET_WITHDRAWALS_ENABLED",
  payouts: "SPEED_WALLET_PAYOUTS_ENABLED",
  payoutStatus: "SPEED_WALLET_PAYOUT_STATUS_ENABLED",
  manualSwap: "SPEED_WALLET_MANUAL_SWAP_ENABLED",
  automaticPayouts: "SPEED_WALLET_AUTOMATIC_PAYOUTS_ENABLED",
  automaticSwap: "SPEED_WALLET_AUTOMATIC_SWAP_ENABLED",
}

function isEnvFlagTrue(name: string): boolean {
  return String(process.env[name] || "").trim() === "true"
}

function isSpeedConnectEnabled(): boolean {
  return isEnvFlagTrue("SPEED_CONNECT_ENABLED")
}

export function isSpeedWalletAccountScopingConfirmed(): boolean {
  return isEnvFlagTrue("SPEED_WALLET_ACCOUNT_SCOPING_CONFIRMED")
}

/**
 * Computes the live wallet-management capability set. Pure function of
 * process.env - never makes a network call. Safe to call on every request.
 */
export function getSpeedWalletCapabilities(): SpeedWalletCapabilitiesResult {
  const speedConfig = getPineTreeSpeedConfigStatus()
  const speedConnectEnabled = isSpeedConnectEnabled()
  const accountScopingConfirmed = isSpeedWalletAccountScopingConfirmed()

  const details = {} as Record<SpeedWalletCapabilityKey, SpeedWalletCapabilityDetail>
  const capabilities = {} as SpeedWalletCapabilities

  for (const key of Object.keys(CAPABILITY_ENV_FLAG) as SpeedWalletCapabilityKey[]) {
    let reason: SpeedWalletCapabilityReason
    if (!speedConfig.configured) {
      reason = "speed_not_configured"
    } else if (!speedConnectEnabled) {
      reason = "speed_connect_disabled"
    } else if (!accountScopingConfirmed) {
      reason = "scoping_not_confirmed"
    } else if (!isEnvFlagTrue(CAPABILITY_ENV_FLAG[key])) {
      reason = "capability_flag_disabled"
    } else {
      reason = "available"
    }

    details[key] = { available: reason === "available", reason }
    capabilities[key] = reason === "available"
  }

  return {
    capabilities,
    details,
    accountScopingConfirmed,
    speedConnectEnabled,
    speedConfigured: speedConfig.configured,
  }
}

export function getSpeedWalletCapabilityDetail(key: SpeedWalletCapabilityKey): SpeedWalletCapabilityDetail {
  return getSpeedWalletCapabilities().details[key]
}
