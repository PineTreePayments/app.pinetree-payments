import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getPaymentById } from "@/database/payments"
import { getTransactionByPaymentId } from "@/database/transactions"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  getActiveMerchantPayoutDestination,
  listMerchantPayoutDestinations,
  upsertMerchantPayoutDestination,
  type MerchantPayoutDestination,
} from "@/database/merchantPayoutDestinations"
import {
  getLightningSettlementSettings,
  upsertLightningSettlementSettings,
} from "@/database/lightningSettlementSettings"
import {
  claimLightningSettlementPayoutJob,
  createLightningSettlementPayoutJobIfMissing,
  listLightningSettlementPayoutJobsForMerchant,
  listQueuedLightningSettlementPayoutJobs,
  markLightningSettlementPayoutJobFailed,
  markLightningSettlementPayoutJobSubmitted,
  type LightningSettlementPayoutJob,
} from "@/database/lightningSettlementPayoutJobs"
import {
  createSpeedLightningPayout,
  getSpeedLightningCapabilities,
  syncSpeedAutoswapSettings,
} from "@/providers/speed/speedLightningSettlement"
import { validateBitcoinAddressForConfiguredNetwork } from "@/providers/wallets/bitcoinNetworkProvider"

type SettlementSummary = {
  scanned: number
  processed: number
  submitted: number
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
}) {
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

function getSpeedPaymentId(payload: unknown, fallback?: string | null) {
  const object = getSpeedObject(payload)
  return String(object.id || object.payment_id || fallback || "").trim() || null
}

export async function ensureDefaultPineTreeBtcPayoutDestination(
  merchantId: string
): Promise<MerchantPayoutDestination | null> {
  const profile = await getPineTreeWalletProfile(merchantId)
  const btcAddress = String(profile?.btc_address || "").trim()
  if (!btcAddress) return null

  return upsertMerchantPayoutDestination({
    merchantId,
    rail: "bitcoin_lightning",
    asset: "BTC",
    destinationType: "pinetree_btc_wallet",
    destinationAddress: btcAddress,
    label: "PineTree BTC Wallet",
    status: "active",
    provider: "pinetree",
    verifiedAt: profile?.btc_payout_verified_at || new Date().toISOString(),
  })
}

export async function getLightningSettlementOverview(merchantId: string) {
  const [destinations, settings, jobs, capabilities] = await Promise.all([
    listMerchantPayoutDestinations(merchantId, { rail: "bitcoin_lightning", asset: "BTC" }),
    getLightningSettlementSettings(merchantId),
    listLightningSettlementPayoutJobsForMerchant(merchantId, 10).catch(() => []),
    Promise.resolve(getSpeedLightningCapabilities()),
  ])
  const defaultDestination = destinations.find((item) => item.status === "active") ||
    await ensureDefaultPineTreeBtcPayoutDestination(merchantId)

  return {
    settings,
    destinations: defaultDestination && !destinations.some((item) => item.id === defaultDestination.id)
      ? [defaultDestination, ...destinations]
      : destinations,
    capabilities,
    recentPayouts: jobs,
  }
}

export async function setLightningSettlementDestination(input: {
  merchantId: string
  destinationType: "pinetree_btc_wallet" | "external_btc_wallet"
  destinationAddress?: string | null
  label?: string | null
}) {
  if (input.destinationType === "external_btc_wallet") {
    const addr = String(input.destinationAddress || "").trim()
    if (!addr) {
      throw Object.assign(new Error("External BTC payout address is required."), { status: 400 })
    }
    if (!validateBitcoinAddressForConfiguredNetwork(addr)) {
      throw Object.assign(new Error("External BTC payout address is not a valid Bitcoin address."), { status: 400 })
    }
  }

  const destination = input.destinationType === "pinetree_btc_wallet"
    ? await ensureDefaultPineTreeBtcPayoutDestination(input.merchantId)
    : await upsertMerchantPayoutDestination({
        merchantId: input.merchantId,
        rail: "bitcoin_lightning",
        asset: "BTC",
        destinationType: "external_btc_wallet",
        destinationAddress: String(input.destinationAddress || "").trim(),
        label: input.label || "External BTC wallet",
        status: "active",
        provider: "pinetree",
        verifiedAt: new Date().toISOString(),
      })

  if (!destination) {
    throw Object.assign(new Error("PineTree BTC Wallet address is not available."), { status: 409 })
  }

  const autoswap = await syncSpeedAutoswapSettings({
    merchantId: input.merchantId,
    enabled: true,
    destinationAddress: destination.destination_address,
    destinationType: destination.destination_type,
  })

  const settings = await upsertLightningSettlementSettings({
    merchantId: input.merchantId,
    enabled: true,
    autoswapEnabled: true,
    payoutDestinationId: destination.id,
    providerReference: autoswap.providerReference,
    providerSyncStatus: autoswap.status,
    lastError: autoswap.synced ? null : autoswap.message,
  })

  return { destination, settings, autoswap }
}

export async function ensureLightningSettlementJobForConfirmedSpeedPayment(input: {
  paymentId: string
  payload?: unknown
}): Promise<LightningSettlementPayoutJob | null> {
  const payment = await getPaymentById(input.paymentId)
  if (!payment || payment.provider !== SPEED_PROVIDER_NAME) return null
  if (String(payment.network || "").toLowerCase() !== "bitcoin_lightning") return null
  if (String(payment.status || "").toUpperCase() !== "CONFIRMED") return null

  const settings = await getLightningSettlementSettings(payment.merchant_id)
  const destination = settings?.payout_destination_id
    ? await getActiveMerchantPayoutDestination(payment.merchant_id, settings.payout_destination_id)
    : await ensureDefaultPineTreeBtcPayoutDestination(payment.merchant_id)

  if (!destination || destination.status !== "active") return null

  const transaction = await getTransactionByPaymentId(payment.id)
  const speedMetadata = getSpeedMetadata(input.payload)
  const paymentMetadata = (payment.metadata || {}) as Record<string, unknown>
  const split = (paymentMetadata.split || {}) as Record<string, unknown>
  const grossAmountUsd = positiveNumber(speedMetadata.grossAmount, speedMetadata.gross_amount, split.grossAmount, payment.gross_amount)
  const feeAmountUsd = positiveNumber(speedMetadata.platform_fee_usd, speedMetadata.pineTreeFeeAmount, split.feeNativeAmount, payment.pinetree_fee)
  const merchantNetUsd = positiveNumber(speedMetadata.merchant_net_usd, speedMetadata.merchantAmount, split.merchantNativeAmount, payment.merchant_amount)
  const merchantNetSats = toSats({ merchantNetUsd, paymentMetadata, speedMetadata })

  if (merchantNetSats <= 0) return null

  return createLightningSettlementPayoutJobIfMissing({
    merchantId: payment.merchant_id,
    paymentId: payment.id,
    transactionId: transaction?.id || null,
    speedPaymentId: getSpeedPaymentId(input.payload, payment.provider_reference),
    grossAmountDecimal: String(grossAmountUsd),
    feeAmountDecimal: String(feeAmountUsd),
    merchantNetAmountDecimal: String(merchantNetSats),
    asset: "BTC",
    destinationAddress: destination.destination_address,
    destinationType: destination.destination_type,
    idempotencyKey: `lightning-settlement:${payment.id}`,
  })
}

async function processOneLightningSettlementPayoutJob(
  job: LightningSettlementPayoutJob
): Promise<"submitted" | "failed" | "skipped"> {
  const claimed = await claimLightningSettlementPayoutJob(job.id)
  if (!claimed) return "skipped"

  try {
    const payment = await getPaymentById(claimed.payment_id)
    if (!payment || String(payment.status || "").toUpperCase() !== "CONFIRMED") {
      throw new Error("Cannot process Lightning settlement before payment is confirmed.")
    }

    const activeDestinations = await listMerchantPayoutDestinations(claimed.merchant_id, {
      rail: "bitcoin_lightning",
      asset: "BTC",
      activeOnly: true,
    })
    const destination = activeDestinations.find((item) =>
      item.destination_type === claimed.destination_type &&
      item.destination_address === claimed.destination_address
    )
    if (!destination) {
      throw new Error("Saved active payout destination is required before Lightning settlement can process.")
    }

    const payout = await createSpeedLightningPayout({
      merchantId: claimed.merchant_id,
      paymentId: claimed.payment_id,
      amountSats: Number(claimed.merchant_net_amount_decimal),
      destinationBtcAddress: destination.destination_address,
      destinationType: destination.destination_type,
      idempotencyKey: claimed.idempotency_key,
    })

    await markLightningSettlementPayoutJobSubmitted(claimed.id, {
      providerPayoutId: String(payout.payout_id || payout.id || "").trim() || null,
      providerReference: String(payout.id || payout.payout_id || "").trim() || null,
      txHash: String(payout.txid || payout.transaction_hash || "").trim() || null,
    })
    return "submitted"
  } catch (error) {
    await markLightningSettlementPayoutJobFailed(
      claimed.id,
      error instanceof Error ? error.message : String(error)
    )
    return "failed"
  }
}

export async function processQueuedLightningSettlementPayoutJobs(
  options: { limit?: number } = {}
): Promise<SettlementSummary> {
  const limit = Math.max(1, Math.min(Number(options.limit || 5), 10))
  const jobs = await listQueuedLightningSettlementPayoutJobs(limit)
  const summary: SettlementSummary = {
    scanned: jobs.length,
    processed: 0,
    submitted: 0,
    failed: 0,
    skipped: 0,
  }

  for (const job of jobs) {
    const result = await processOneLightningSettlementPayoutJob(job)
    if (result !== "skipped") summary.processed += 1
    summary[result] += 1
  }

  return summary
}
