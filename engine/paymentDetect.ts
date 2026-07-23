import { getPaymentById } from "@/database"
import {
  getTransactionByPaymentId,
  updateTransactionProviderReference
} from "@/database/transactions"
import type { StoredPaymentSplitMetadata } from "@/types/payment"
import { processPaymentEvent } from "./eventProcessor"
import { ensurePaymentFresh } from "./paymentMaintenance"
import { logConfirmationTrace } from "@/lib/payment/confirmationTrace"

export type PaymentDetectResult = {
  httpStatus: number
  body: {
    error?: string
    detected?: boolean
    skipped?: boolean
    status?: string
  }
}

function isEvmTxHash(value?: string): value is string {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim())
}

export async function runPaymentDetectForPayment(
  paymentId: string,
  options?: { txHash?: string; sessionAttemptId?: string }
): Promise<PaymentDetectResult> {
  const sessionAttemptId = options?.sessionAttemptId
  const payment = await getPaymentById(paymentId)
  if (!payment) {
    return { httpStatus: 404, body: { error: "Payment not found" } }
  }

  logConfirmationTrace("detect_request_received", {
    paymentId,
    sessionAttemptId,
    transactionHash: options?.txHash,
    payload: { network: payment.network }
  })

  const currentStatus = String(payment.status || "").toUpperCase()
  if (currentStatus === "CONFIRMED" || currentStatus === "FAILED" || currentStatus === "INCOMPLETE") {
    return {
      httpStatus: 200,
      body: { detected: false, skipped: true, status: currentStatus }
    }
  }

  const txHash = String(options?.txHash || "").trim() || undefined
  const isBase = String(payment.network || "").toLowerCase() === "base"

  if (isBase) {
    const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
    console.info("[PineTreeBaseTrace] detect called", {
      step: "detect-entry",
      paymentId,
      txHashPresent: Boolean(txHash),
      network: payment.network,
      asset: split?.asset || null,
      v7RouteUsed: true,
      baseUsdcStrategy: split?.baseUsdcStrategy || null,
      splitContract: split?.splitContract || null,
      paymentStatus: payment.status
    })

    if (txHash && !isEvmTxHash(txHash)) {
      console.warn("[PineTreeBaseTrace] detect invalid tx hash", {
        step: "detect-invalid-txhash",
        paymentId,
        txHashPresent: true
      })
      return { httpStatus: 400, body: { error: "Invalid Base transaction hash" } }
    }

    if (txHash) {
      const transaction = await getTransactionByPaymentId(paymentId)
      if (transaction && !transaction.provider_transaction_id) {
        try {
          await updateTransactionProviderReference(transaction.id, txHash)
        } catch (error) {
          console.warn("[PineTreeBaseTrace] detect tx hash store failed", {
            step: "detect-store-txhash-failed",
            paymentId,
            txHashPresent: true,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }
  }

  if (txHash) {
    await processPaymentEvent({
      type: "payment.processing",
      paymentId,
      txHash
    })
  }

  console.info("[detect] triggered", { paymentId, txHash, network: payment.network })
  const freshness = await ensurePaymentFresh(paymentId, { txHash, forceWatcher: true, sessionAttemptId })
  const updatedPayment = await getPaymentById(paymentId)
  const detected = Boolean(freshness?.detected)
  const status = String(updatedPayment?.status || payment.status || "").toUpperCase()

  logConfirmationTrace("detect_request_completed", {
    paymentId,
    sessionAttemptId,
    transactionHash: txHash,
    payload: { detected, status }
  })

  if (isBase) {
    console.info("[PineTreeBaseTrace] detect watcher result", {
      step: "detect-watcher-done",
      paymentId,
      txHashPresent: Boolean(txHash),
      network: payment.network,
      detected,
      finalPaymentStatus: status
    })
  }

  return { httpStatus: 200, body: { detected, status } }
}
