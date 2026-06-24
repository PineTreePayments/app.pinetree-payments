import { getPaymentById } from "@/database/payments"
import { getTransactionByPaymentId } from "@/database/transactions"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  claimLightningPayoutJob,
  createLightningPayoutJobIfMissing,
  getLightningPayoutJobByPayment,
  listPendingLightningPayoutJobs,
  markLightningPayoutJobCompleted,
  markLightningPayoutJobFailed,
  type LightningPayoutJob
} from "@/database/lightningPayoutJobs"
import {
  createSpeedWithdrawRequest,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE
} from "@/providers/lightning/speedClient"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"

type ProcessLightningPayoutJobsResult = {
  scanned: number
  processed: number
  completed: number
  failed: number
  skipped: number
}

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function getSpeedObject(payload: unknown): Record<string, unknown> {
  const object =
    readPath(payload, ["data", "object"]) ||
    readPath(payload, ["event", "data", "object"]) ||
    payload
  return object && typeof object === "object" ? object as Record<string, unknown> : {}
}

function getSpeedMetadata(payload: unknown): Record<string, unknown> {
  const object = getSpeedObject(payload)
  return object.metadata && typeof object.metadata === "object"
    ? object.metadata as Record<string, unknown>
    : {}
}

function positiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
  }
  return 0
}

function toSats(input: {
  merchantNetUsd: number
  paymentMetadata: Record<string, unknown>
  speedMetadata: Record<string, unknown>
}): number {
  const explicit = positiveNumber(
    input.speedMetadata.merchant_net_sats,
    input.paymentMetadata.merchant_net_sats,
    (input.paymentMetadata.split as Record<string, unknown> | undefined)?.merchantNativeAmountAtomic
  )
  if (explicit > 0) return Math.round(explicit)

  const split = input.paymentMetadata.split as Record<string, unknown> | undefined
  const btcPriceUsd = positiveNumber(
    split?.quotePriceUsd,
    input.speedMetadata.btc_price_usd,
    input.paymentMetadata.btcPriceUsd
  )
  if (btcPriceUsd <= 0) return 0
  return Math.round((input.merchantNetUsd / btcPriceUsd) * 100_000_000)
}

function getMinimumPayoutSats(): number {
  const configured = Number(process.env.PINE_TREE_LIGHTNING_MIN_PAYOUT_SATS || "")
  return Number.isFinite(configured) && configured > 0 ? configured : 1
}

function getSpeedId(payload: unknown): string | null {
  const object = getSpeedObject(payload)
  return String(object.id || object.payment_id || "").trim() || null
}

function summarizeSpeedPayoutResponse(response: Record<string, unknown>): Record<string, unknown> {
  return {
    id: response.id || null,
    object: response.object || null,
    status: response.status || null,
    payout_id: response.payout_id || null,
    txid: response.txid || response.transaction_hash || null,
    withdraw_method: response.withdraw_method || null,
    withdraw_request_present: Boolean(response.withdraw_request),
    currency: response.currency || null,
    target_currency: response.target_currency || null
  }
}

export async function ensureLightningPayoutJobForConfirmedSpeedPayment(input: {
  paymentId: string
  payload?: unknown
}): Promise<LightningPayoutJob | null> {
  if (!isSpeedPlatformTreasurySweepEnabled()) return null

  const payment = await getPaymentById(input.paymentId)
  if (!payment || payment.provider !== SPEED_PROVIDER_NAME) return null
  if (String(payment.status || "").toUpperCase() !== "CONFIRMED") return null

  const speedMetadata = getSpeedMetadata(input.payload)
  const settlementMode = String(
    speedMetadata.settlement_mode ||
      speedMetadata.settlementMode ||
      (payment.metadata as Record<string, unknown> | null)?.settlementMode ||
      ""
  ).trim()
  if (settlementMode !== SPEED_PLATFORM_TREASURY_SWEEP_MODE) return null

  const existing = await getLightningPayoutJobByPayment({
    paymentId: payment.id,
    provider: SPEED_PROVIDER_NAME,
    settlementMode: SPEED_PLATFORM_TREASURY_SWEEP_MODE
  })
  if (existing) return existing

  const transaction = await getTransactionByPaymentId(payment.id)
  const paymentMetadata = (payment.metadata || {}) as Record<string, unknown>
  const split = (paymentMetadata.split || {}) as Record<string, unknown>
  const grossAmountUsd = positiveNumber(
    speedMetadata.grossAmount,
    speedMetadata.gross_amount,
    speedMetadata.gross_amount_usd,
    split.grossAmount,
    payment.gross_amount
  )
  const platformFeeUsd = positiveNumber(
    speedMetadata.platform_fee_usd,
    speedMetadata.pineTreeFeeAmount,
    speedMetadata.pineTreeFee,
    split.feeNativeAmount,
    payment.pinetree_fee
  )
  const merchantNetUsd = positiveNumber(
    speedMetadata.merchant_net_usd,
    speedMetadata.merchantAmount,
    split.merchantNativeAmount,
    payment.merchant_amount
  )

  return createLightningPayoutJobIfMissing({
    merchant_id: payment.merchant_id,
    payment_id: payment.id,
    transaction_id: transaction?.id || null,
    provider: SPEED_PROVIDER_NAME,
    settlement_mode: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
    speed_invoice_id: getSpeedId(input.payload) || payment.provider_reference || null,
    speed_payment_id: getSpeedId(input.payload) || payment.provider_reference || null,
    gross_amount_usd: grossAmountUsd,
    platform_fee_usd: platformFeeUsd,
    merchant_net_usd: merchantNetUsd,
    merchant_net_sats: toSats({ merchantNetUsd, paymentMetadata, speedMetadata }),
    status: "pending"
  })
}

async function processOneLightningPayoutJob(job: LightningPayoutJob): Promise<"completed" | "failed" | "skipped"> {
  const claimed = await claimLightningPayoutJob(job.id)
  if (!claimed) return "skipped"

  try {
    const payment = await getPaymentById(claimed.payment_id)
    if (!payment || String(payment.status || "").toUpperCase() !== "CONFIRMED") {
      throw new Error("Cannot process Lightning payout before payment is confirmed")
    }

    const completed = await getLightningPayoutJobByPayment({
      paymentId: claimed.payment_id,
      provider: claimed.provider,
      settlementMode: claimed.settlement_mode
    })
    if (completed?.status === "completed") return "skipped"

    const profile = await getPineTreeWalletProfile(claimed.merchant_id)
    const btcAddress = String(profile?.btc_address || claimed.btc_payout_address || "").trim()
    const btcAddressType = String(profile?.btc_address_type || claimed.btc_address_type || "").trim() || null
    if (!profile?.btc_payout_enabled || !btcAddress) {
      throw new Error("Merchant BTC payout address is required before Lightning payout can process")
    }

    const minimumSats = getMinimumPayoutSats()
    if (Number(claimed.merchant_net_sats || 0) < minimumSats) {
      throw new Error(`Merchant net amount is below minimum payout threshold (${minimumSats} sats)`)
    }

    const withdraw = await createSpeedWithdrawRequest({
      merchantId: claimed.merchant_id,
      paymentId: claimed.payment_id,
      amount: Number(claimed.merchant_net_sats),
      currency: "SATS",
      destinationBtcAddress: btcAddress,
      destinationAddressType: btcAddressType,
      idempotencyKey: `lightning-payout:${claimed.id}`,
      metadata: {
        merchant_id: claimed.merchant_id,
        payment_id: claimed.payment_id,
        transaction_id: claimed.transaction_id,
        settlement_mode: claimed.settlement_mode,
        btc_address_type: btcAddressType
      }
    })

    await markLightningPayoutJobCompleted(claimed.id, {
      speedWithdrawRequestId: String(withdraw.id || claimed.speed_withdraw_request_id || "").trim() || null,
      speedPayoutId: String(withdraw.payout_id || "").trim() || null,
      txid: String(withdraw.txid || withdraw.transaction_hash || "").trim() || null,
      providerResponseSummary: summarizeSpeedPayoutResponse(withdraw)
    })
    return "completed"
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markLightningPayoutJobFailed(claimed.id, message)
    return "failed"
  }
}

export async function processPendingLightningPayoutJobs(
  options: { limit?: number } = {}
): Promise<ProcessLightningPayoutJobsResult> {
  const jobs = await listPendingLightningPayoutJobs(options.limit ?? 25)
  const summary: ProcessLightningPayoutJobsResult = {
    scanned: jobs.length,
    processed: 0,
    completed: 0,
    failed: 0,
    skipped: 0
  }

  for (const job of jobs) {
    const result = await processOneLightningPayoutJob(job)
    if (result !== "skipped") summary.processed += 1
    summary[result] += 1
  }

  return summary
}

export async function processLightningPayoutJobByPayment(input: {
  paymentId: string
  provider?: string
  settlementMode?: string
}): Promise<"completed" | "failed" | "skipped"> {
  const job = await getLightningPayoutJobByPayment({
    paymentId: input.paymentId,
    provider: input.provider || SPEED_PROVIDER_NAME,
    settlementMode: input.settlementMode || SPEED_PLATFORM_TREASURY_SWEEP_MODE
  })
  if (!job || job.status === "completed" || job.status === "canceled") return "skipped"
  return processOneLightningPayoutJob(job)
}
