/**
 * Speed Instant Send adapter boundary.
 *
 * Speed has confirmed PineTree can programmatically send SATS from a Custom
 * Connect merchant account to a BOLT11 invoice using PineTree's platform API
 * key, with connected-account context supplied via
 * `X-Speed-Account: {connected_account_id}` (below Speed's $20 automatic
 * payout minimum). Speed has NOT yet supplied the exact:
 *   - Instant Send endpoint URL / HTTP method / request body schema
 *   - response schema
 *   - balance endpoint
 *   - idempotency header or request field
 *   - connected-account identifier format required by X-Speed-Account
 *   - success/failure event names
 *
 * This module is the ONLY place allowed to eventually translate Speed's raw
 * request/response shape - engine code (engine/lightningSweep.ts) must only
 * ever depend on the stable types exported here, never on Speed's payload
 * shape directly.
 *
 * Until Speed supplies the exact contract, every exported function here
 * throws SpeedInstantSendNotConfiguredError and issues ZERO HTTP requests -
 * see the reason codes below. Implementing the real request/response
 * translation is a follow-up change once the contract is confirmed; this
 * file intentionally does not guess at it.
 */

import { getSpeedApiHost } from "./speedClient"

export type SpeedInstantSendConfigReason =
  | "feature_disabled"
  | "endpoint_not_configured"
  | "contract_unconfirmed"

export class SpeedInstantSendNotConfiguredError extends Error {
  readonly reason: SpeedInstantSendConfigReason

  constructor(reason: SpeedInstantSendConfigReason, detail: string) {
    super(`Speed Instant Send is not available (${reason}): ${detail}`)
    this.name = "SpeedInstantSendNotConfiguredError"
    this.reason = reason
  }
}

/**
 * PineTree's own stable internal error shape for a real (post-contract)
 * Speed Instant Send failure - the future implementation of
 * sendToLightningInvoice/getConnectedAccountBalance must translate Speed's
 * raw error response into this shape rather than letting engine code depend
 * on Speed's payload directly. `retryable: false` means a deterministic
 * rejection (bad request, permanently invalid account, etc.) that must not
 * be retried; `retryable: true` covers network failures, HTTP 429, and 5xx.
 */
export class SpeedInstantSendProviderError extends Error {
  readonly httpStatus: number | null
  readonly retryable: boolean
  readonly providerCode: string | null

  constructor(
    message: string,
    options: { httpStatus?: number | null; retryable: boolean; providerCode?: string | null }
  ) {
    super(message)
    this.name = "SpeedInstantSendProviderError"
    this.httpStatus = options.httpStatus ?? null
    this.retryable = options.retryable
    this.providerCode = options.providerCode ?? null
  }
}

export function isSpeedLightningSweepEnabled(): boolean {
  return String(process.env.SPEED_LIGHTNING_SWEEP_ENABLED || "").trim() === "true"
}

function requireSweepEnabled(): void {
  if (!isSpeedLightningSweepEnabled()) {
    throw new SpeedInstantSendNotConfiguredError(
      "feature_disabled",
      "SPEED_LIGHTNING_SWEEP_ENABLED is not exactly \"true\". No outbound Speed Instant Send call may occur."
    )
  }
}

function requireEndpointConfigured(envVar: string, label: string): string {
  const value = String(process.env[envVar] || "").trim()
  if (!value) {
    throw new SpeedInstantSendNotConfiguredError(
      "endpoint_not_configured",
      `${envVar} (${label}) is not set. This is a placeholder variable until Speed supplies the exact endpoint - it must remain unset until then.`
    )
  }
  return value
}

/**
 * Every call currently reaches this before any HTTP request would be made.
 * Even with the feature flag on and endpoint URLs configured, the exact
 * request/response schema is unknown, so no request can be safely built or
 * parsed yet. This function exists as a single, obvious chokepoint so a
 * future change wiring the real contract only has to touch one place.
 */
function requireContractConfirmed(operation: string): never {
  throw new SpeedInstantSendNotConfiguredError(
    "contract_unconfirmed",
    `Speed has not yet supplied the ${operation} request/response schema. ` +
      "Implement the real translation in providers/lightning/speedInstantSend.ts once Speed's contract is confirmed - do not guess it."
  )
}

export type SpeedConnectedAccountBalance = {
  availableSats: number
  asOf: string
  raw: unknown
}

export type GetConnectedAccountBalanceInput = {
  speedHeaderAccountId: string
}

/**
 * Retrieves the connected account's available SATS balance. Throws
 * SpeedInstantSendNotConfiguredError (never issues an HTTP request) until
 * SPEED_CONNECTED_BALANCE_ENDPOINT and the response schema are confirmed.
 */
export async function getConnectedAccountBalance(
  input: GetConnectedAccountBalanceInput
): Promise<SpeedConnectedAccountBalance> {
  requireSweepEnabled()
  requireEndpointConfigured("SPEED_CONNECTED_BALANCE_ENDPOINT", "connected-account balance endpoint")
  // Prove the resolved header account id and platform credentials are at
  // least present before failing on the unconfirmed contract, so a
  // misconfigured deploy fails with the most specific reason available.
  if (!input.speedHeaderAccountId.trim()) {
    throw new SpeedInstantSendNotConfiguredError("contract_unconfirmed", "Missing resolved X-Speed-Account value.")
  }
  getSpeedApiHost()
  requireContractConfirmed("connected-account balance")
}

export type SendToLightningInvoiceInput = {
  speedHeaderAccountId: string
  invoice: string
  amountSats: number
  idempotencyKey: string
}

export type SpeedInstantSendResult = {
  providerSendId: string
  providerStatus: string
  raw: unknown
}

/**
 * Sends SATS from the connected Speed account to a BOLT11 invoice via
 * Instant Send. Throws SpeedInstantSendNotConfiguredError (never issues an
 * HTTP request) until SPEED_INSTANT_SEND_ENDPOINT and the request/response
 * schema are confirmed.
 */
export async function sendToLightningInvoice(
  input: SendToLightningInvoiceInput
): Promise<SpeedInstantSendResult> {
  requireSweepEnabled()
  requireEndpointConfigured("SPEED_INSTANT_SEND_ENDPOINT", "Instant Send endpoint")
  if (!input.speedHeaderAccountId.trim() || !input.invoice.trim() || !input.idempotencyKey.trim()) {
    throw new SpeedInstantSendNotConfiguredError(
      "contract_unconfirmed",
      "Missing resolved X-Speed-Account value, invoice, or idempotency key."
    )
  }
  getSpeedApiHost()
  requireContractConfirmed("Instant Send")
}

export type GetInstantSendStatusInput = {
  speedHeaderAccountId: string
  providerSendId: string
}

/**
 * Retrieves the current status of a previously-submitted Instant Send.
 * Throws SpeedInstantSendNotConfiguredError (never issues an HTTP request)
 * until the status-check contract is confirmed.
 */
export async function getInstantSendStatus(
  input: GetInstantSendStatusInput
): Promise<{ providerStatus: string; raw: unknown }> {
  requireSweepEnabled()
  requireEndpointConfigured("SPEED_INSTANT_SEND_ENDPOINT", "Instant Send endpoint")
  if (!input.speedHeaderAccountId.trim() || !input.providerSendId.trim()) {
    throw new SpeedInstantSendNotConfiguredError(
      "contract_unconfirmed",
      "Missing resolved X-Speed-Account value or provider send id."
    )
  }
  getSpeedApiHost()
  requireContractConfirmed("Instant Send status check")
}
