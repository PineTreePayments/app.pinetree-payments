/**
 * Lightning-sweep compatibility adapter over the confirmed Speed wallet
 * boundary. All HTTP/auth/header construction remains centralized in
 * speedClient.ts via speedWalletManagement.ts.
 */

import {
  SpeedWalletCapabilityUnavailableError,
  SpeedWalletProviderError,
  createConnectedAccountWithdrawal,
  getConnectedAccountBalances,
  getConnectedAccountSendStatus,
} from "./speedWalletManagement"

export type SpeedInstantSendConfigReason = "feature_disabled" | "contract_unconfirmed"

export class SpeedInstantSendNotConfiguredError extends Error {
  readonly reason: SpeedInstantSendConfigReason

  constructor(reason: SpeedInstantSendConfigReason, detail: string) {
    super(`Speed Instant Send is not available (${reason}): ${detail}`)
    this.name = "SpeedInstantSendNotConfiguredError"
    this.reason = reason
  }
}

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
      "SPEED_LIGHTNING_SWEEP_ENABLED is not exactly \"true\"."
    )
  }
}

async function translate<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof SpeedWalletCapabilityUnavailableError) {
      throw new SpeedInstantSendNotConfiguredError("contract_unconfirmed", "The connected-account capability is disabled.")
    }
    if (error instanceof SpeedWalletProviderError) {
      throw new SpeedInstantSendProviderError("Speed could not complete the Instant Send request.", {
        httpStatus: error.httpStatus,
        retryable: error.retryable,
        providerCode: error.providerCode,
      })
    }
    throw error
  }
}

export type SpeedConnectedAccountBalance = {
  availableSats: number
  asOf: string
  raw: null
}

export type GetConnectedAccountBalanceInput = {
  speedHeaderAccountId: string
  merchantId?: string
}

export async function getConnectedAccountBalance(
  input: GetConnectedAccountBalanceInput
): Promise<SpeedConnectedAccountBalance> {
  requireSweepEnabled()
  return translate(async () => {
    const balance = await getConnectedAccountBalances({
      merchantId: input.merchantId || "lightning-sweep",
      speedAccountId: input.speedHeaderAccountId,
    })
    const sats = balance.available.find((entry) => String(entry.target_currency).toUpperCase() === "SATS")
    const amount = sats ? Number(sats.amount) : 0
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new SpeedInstantSendProviderError("Speed returned an invalid SATS balance.", {
        retryable: true,
        providerCode: "malformed_balance",
      })
    }
    return { availableSats: amount, asOf: new Date().toISOString(), raw: null }
  })
}

export type SendToLightningInvoiceInput = {
  speedHeaderAccountId: string
  invoice: string
  amountSats: number
  idempotencyKey: string
  merchantId?: string
}

export type SpeedInstantSendResult = {
  providerSendId: string
  providerStatus: string
  raw: null
}

export async function sendToLightningInvoice(
  input: SendToLightningInvoiceInput
): Promise<SpeedInstantSendResult> {
  requireSweepEnabled()
  return translate(async () => {
    const result = await createConnectedAccountWithdrawal({
      merchantId: input.merchantId || "lightning-sweep",
      speedAccountId: input.speedHeaderAccountId,
      amount: input.amountSats,
      currency: "SATS",
      withdrawMethod: "lightning",
      withdrawRequest: input.invoice,
      idempotencyKey: input.idempotencyKey,
    })
    return { providerSendId: result.id, providerStatus: result.status, raw: null }
  })
}

export type GetInstantSendStatusInput = {
  speedHeaderAccountId: string
  providerSendId: string
  merchantId?: string
}

export async function getInstantSendStatus(
  input: GetInstantSendStatusInput
): Promise<{ providerStatus: string; raw: null }> {
  requireSweepEnabled()
  return translate(async () => {
    const result = await getConnectedAccountSendStatus({
      merchantId: input.merchantId || "lightning-sweep",
      speedAccountId: input.speedHeaderAccountId,
      providerSendId: input.providerSendId,
    })
    return { providerStatus: result.status, raw: null }
  })
}
