import { getPaymentById, getPaymentIntentById } from "@/database"
import { watchPayment } from "./paymentWatcher"
import { AUTO_POLLING_ENABLED } from "./config"

type PaymentWatchSplitMetadata = {
  split?: {
    merchantWallet?: string
    pinetreeWallet?: string
    feeCaptureMethod?: string
    splitContract?: string
    expectedAmountNative?: number
    merchantNativeAmountAtomic?: string | number
    feeNativeAmountAtomic?: string | number
  }
}

type WatchablePayment = {
  id: string
  status?: string
  network?: string
  merchant_amount: number
  pinetree_fee: number
  metadata?: unknown
}

export function normalizePaymentStatus(status: unknown) {
  const normalized = String(status || "").toUpperCase()

  if (normalized === "EXPIRED") return "INCOMPLETE"

  if (
    normalized === "CREATED" ||
    normalized === "PENDING" ||
    normalized === "PROCESSING" ||
    normalized === "CONFIRMED" ||
    normalized === "FAILED" ||
    normalized === "INCOMPLETE"
  ) {
    return normalized
  }

  return "PENDING"
}

function canWatchStatus(status: string) {
  return status === "CREATED" || status === "PENDING" || status === "PROCESSING"
}

export async function queueSingleWatcherIteration(payment: WatchablePayment, source: string) {
  if (!AUTO_POLLING_ENABLED) {
    console.info("[payment-status] watcher:disabled", {
      source,
      paymentId: payment.id
    })
    return
  }

  const status = normalizePaymentStatus(payment.status)
  if (!canWatchStatus(status)) {
    console.info("[payment-status] watcher:skip", {
      source,
      paymentId: payment.id,
      reason: "terminal_or_non_active_status",
      status
    })
    return
  }

  const metadata = (payment.metadata || null) as PaymentWatchSplitMetadata | null
  const split = metadata?.split
  const merchantWallet = String(split?.merchantWallet || "").trim()
  const pinetreeWallet = String(split?.pinetreeWallet || "").trim()
  const network = String(payment.network || "").trim()

  if (!merchantWallet || !pinetreeWallet || !network) {
    console.warn("[payment-status] watcher:skip", {
      source,
      paymentId: payment.id,
      reason: "missing_watch_metadata",
      hasMerchantWallet: Boolean(merchantWallet),
      hasPinetreeWallet: Boolean(pinetreeWallet),
      hasNetwork: Boolean(network)
    })
    return
  }

  console.info("[payment-status] watcher:run", {
    source,
    paymentId: payment.id,
    network,
    status
  })

  try {
    await watchPayment({
      merchantWallet,
      pinetreeWallet,
      merchantAmount: Number(payment.merchant_amount || 0),
      pinetreeFee: Number(payment.pinetree_fee || 0),
      expectedAmountNative: split?.expectedAmountNative,
      expectedMerchantAtomic: split?.merchantNativeAmountAtomic,
      expectedFeeAtomic: split?.feeNativeAmountAtomic,
      feeCaptureMethod: split?.feeCaptureMethod,
      splitContract: split?.splitContract,
      network,
      paymentId: payment.id,
      singleIteration: true
    })

    console.info("[payment-status] watcher:completed", {
      source,
      paymentId: payment.id
    })

  } catch (error) {
    console.error("[payment-status] watcher:error", {
      source,
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function getUnifiedPaymentStatusEngine(referenceId: string, source = "unknown") {
  const trimmedReferenceId = String(referenceId || "").trim()
  if (!trimmedReferenceId) {
    const err = new Error("Missing paymentId") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const intent = await getPaymentIntentById(trimmedReferenceId)
  if (intent) {
    if (!intent.payment_id) {
      console.info("[payment-status] resolve:intent_unselected", {
        source,
        intentId: intent.id
      })
      return {
        status: "PENDING",
        paymentId: intent.id,
        intentId: intent.id,
        resolvedFrom: "intent" as const,
        hasSelectedPayment: false
      }
    }

    const selectedPayment = await getPaymentById(intent.payment_id)
    if (!selectedPayment) {
      console.warn("[payment-status] resolve:intent_payment_missing", {
        source,
        intentId: intent.id,
        selectedPaymentId: intent.payment_id
      })
      return {
        status: "PENDING",
        paymentId: intent.id,
        intentId: intent.id,
        resolvedFrom: "intent" as const,
        hasSelectedPayment: false
      }
    }

    await queueSingleWatcherIteration(selectedPayment, `${source}:intent`)

    return {
      status: normalizePaymentStatus(selectedPayment.status),
      paymentId: selectedPayment.id,
      intentId: intent.id,
      resolvedFrom: "intent" as const,
      hasSelectedPayment: true
    }
  }

  const payment = await getPaymentById(trimmedReferenceId)
  if (!payment) {
    const err = new Error("Payment not found") as Error & { status?: number }
    err.status = 404
    throw err
  }

  await queueSingleWatcherIteration(payment, `${source}:payment`)

  return {
    status: normalizePaymentStatus(payment.status),
    paymentId: payment.id,
    intentId: null,
    resolvedFrom: "payment" as const,
    hasSelectedPayment: true
  }
}
