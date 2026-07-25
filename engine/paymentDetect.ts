import { getPaymentById } from "@/database"
import {
  getTransactionByPaymentId,
  updateTransactionProviderReference
} from "@/database/transactions"
import type { StoredPaymentSplitMetadata } from "@/types/payment"
import { processPaymentEvent } from "./eventProcessor"
import { ensurePaymentFresh } from "./paymentMaintenance"
import { logConfirmationTrace } from "@/lib/payment/confirmationTrace"
import { getBaseV7UsdcToken, getRpcUrl } from "./config"
import { classifyBaseV7TransactionRole, type BaseV7TransactionRole } from "./baseV7Evidence"

export type PaymentDetectResult = {
  httpStatus: number
  body: {
    error?: string
    detected?: boolean
    skipped?: boolean
    status?: string
    kind?: string
    reason?: string
  }
}

function isEvmTxHash(value?: string): value is string {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim())
}

function redactAddress(value: unknown): string | null {
  const address = String(value || "").trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

async function fetchBaseTransactionForRole(txHash: string): Promise<{
  to?: string | null
  from?: string | null
  input?: string | null
} | null> {
  const rpcUrl = getRpcUrl("base")
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getTransactionByHash",
      params: [txHash],
      id: 1
    })
  })
  const data = await response.json()
  if (data?.error) {
    throw new Error(`eth_getTransactionByHash RPC error: ${JSON.stringify(data.error)}`)
  }
  return (data?.result || null) as { to?: string | null; from?: string | null; input?: string | null } | null
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

  const txHash = String(options?.txHash || "").trim() || undefined
  const isBase = String(payment.network || "").toLowerCase() === "base"
  const currentStatus = String(payment.status || "").toUpperCase()
  let baseV7TxRole: BaseV7TransactionRole | null = null

  if (isBase) {
    const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
    const isBaseV7Usdc =
      String(split?.asset || "").toUpperCase() === "USDC" &&
      String(split?.feeCaptureMethod || "").toLowerCase() === "contract_split"
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

    if (txHash && isBaseV7Usdc) {
      const transaction = await fetchBaseTransactionForRole(txHash).catch((error) => {
        console.warn("[PineTreeBaseTrace] detect tx role lookup failed", {
          step: "detect-role-lookup-failed",
          paymentId,
          txHashPresent: true,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      })
      baseV7TxRole = classifyBaseV7TransactionRole({
        transactionTo: transaction?.to,
        transactionInput: transaction?.input,
        expectedSplitContract: String(split?.splitContract || ""),
        expectedUsdcToken: getBaseV7UsdcToken()
      })

      console.info("[PineTreeBaseTrace] detect base v7 diagnostic", {
        paymentId,
        intentId:
          String((payment.metadata as { paymentIntentId?: unknown } | null)?.paymentIntentId || "") ||
          null,
        strategy: split?.baseUsdcStrategy || null,
        txHash,
        txHashSource: "request_body",
        allowanceApprovalTxHash: null,
        paymentContractTxHash: baseV7TxRole === "payment_contract" ? txHash : null,
        storedProviderTransactionId:
          String((await getTransactionByPaymentId(paymentId))?.provider_transaction_id || "").trim() || null,
        expectedSplitContract: redactAddress(split?.splitContract),
        merchantWallet: redactAddress(split?.merchantWallet),
        pineTreeWallet: redactAddress(split?.pinetreeWallet),
        expectedGrossAmount: split?.expectedAmountNative ?? null,
        expectedMerchantAmount: split?.merchantNativeAmountAtomic ?? split?.expectedMerchantAtomic ?? null,
        expectedPlatformFee: split?.feeNativeAmountAtomic ?? split?.expectedFeeAtomic ?? null,
        attemptId: sessionAttemptId || null,
        requestSource: "detect_route",
        txRole: baseV7TxRole
      })

      if (baseV7TxRole === "allowance_approval") {
        console.warn("[PineTreeBaseTrace] base_v7_wrong_hash_type", {
          paymentId,
          txHash,
          reason: "allowance_approval_hash"
        })
        return {
          httpStatus: 200,
          body: {
            detected: true,
            status: currentStatus === "CONFIRMED" ? "CONFIRMED" : "PROCESSING",
            kind: "wrong_transaction_type",
            reason: "allowance_approval_hash"
          }
        }
      }
    }

    // Persist the wallet-returned hash BEFORE the terminal-status check
    // below. A wallet returning a hash means a real transaction is already
    // broadcast and irreversible — that evidence must never be dropped, even
    // if this payment has *already* raced to a terminal state (e.g. a
    // merchant cancel that landed a moment before this call reached the
    // server). Recording the hash here — guarded by
    // !transaction.provider_transaction_id so it's a one-time, idempotent
    // write — means self-heal reconciliation can still find and repair the
    // payment later instead of the evidence being silently lost forever.
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

  if (currentStatus === "CONFIRMED" || currentStatus === "FAILED" || currentStatus === "INCOMPLETE") {
    return {
      httpStatus: 200,
      body: { detected: false, skipped: true, status: currentStatus }
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
  const status = String(updatedPayment?.status || payment.status || "").toUpperCase()
  const watcherDetected = Boolean(freshness?.detected)
  const detected = watcherDetected
  const kind = watcherDetected && status === "CONFIRMED"
    ? "confirmed_payment"
    : watcherDetected && status === "FAILED"
      ? "failed_transaction"
      : "not_found"

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
      finalPaymentStatus: status,
      kind
    })
  }

  return { httpStatus: 200, body: { detected, status, kind } }
}
