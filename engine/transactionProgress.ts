import {
  getTransactionByPaymentId,
  updateTransactionStatus,
  type TransactionStatus
} from "@/database/transactions"

const NONTERMINAL_TRANSACTION_STATUSES = new Set<TransactionStatus>(["PENDING", "PROCESSING"])

export type TransactionProgressResult = {
  transactionId: string | null
  previousStatus: string | null
  newStatus: TransactionStatus | null
  skipped: boolean
  skipReason?: string
}

/**
 * Nonterminal transaction progress path.
 *
 * Terminal transaction reconciliation belongs to reconcileTransactionForPayment.
 * This helper is only for in-flight progress, e.g. when the watcher has seen
 * payment activity and the payment has advanced to PROCESSING.
 */
export async function syncTransactionProgressForPayment(
  paymentId: string,
  status: Extract<TransactionStatus, "PROCESSING">
): Promise<TransactionProgressResult> {
  const transaction = await getTransactionByPaymentId(paymentId)
  if (!transaction) {
    return {
      transactionId: null,
      previousStatus: null,
      newStatus: null,
      skipped: true,
      skipReason: "no_linked_transaction"
    }
  }

  if (transaction.status === status) {
    return {
      transactionId: transaction.id,
      previousStatus: transaction.status,
      newStatus: null,
      skipped: true,
      skipReason: "already_in_sync"
    }
  }

  if (!NONTERMINAL_TRANSACTION_STATUSES.has(transaction.status)) {
    return {
      transactionId: transaction.id,
      previousStatus: transaction.status,
      newStatus: null,
      skipped: true,
      skipReason: "terminal_transaction_not_overwritten"
    }
  }

  await updateTransactionStatus(transaction.id, status)
  return {
    transactionId: transaction.id,
    previousStatus: transaction.status,
    newStatus: status,
    skipped: false
  }
}
