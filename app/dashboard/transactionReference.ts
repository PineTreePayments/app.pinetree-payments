type PaymentReferenceFields = {
  id?: string | null
  provider_reference?: string | null
}

type TransactionReferenceFields = {
  id?: string | null
  payment_id?: string | null
  provider?: string | null
  provider_transaction_id?: string | null
  payments?: PaymentReferenceFields | PaymentReferenceFields[] | null
}

export function firstReferenceValue(value: string | null | undefined) {
  const normalized = String(value || "").trim()
  return normalized.length > 0 ? normalized : null
}

export function shortReferenceId(value: string | null | undefined) {
  const normalized = firstReferenceValue(value)
  if (!normalized) return null
  return normalized.length > 12 ? `${normalized.slice(0, 12)}...` : normalized
}

export function getTransactionReferenceParts(tx: TransactionReferenceFields) {
  const payment = Array.isArray(tx.payments) ? tx.payments[0] : tx.payments
  const paymentId = firstReferenceValue(payment?.id) || firstReferenceValue(tx.payment_id)
  const transactionId = firstReferenceValue(tx.id)
  const blockchainReference = firstReferenceValue(tx.provider_transaction_id)
  const providerReference = firstReferenceValue(payment?.provider_reference)

  return {
    paymentId,
    transactionId,
    blockchainReference,
    providerReference
  }
}

export function formatTransactionReference(tx: TransactionReferenceFields) {
  const {
    paymentId,
    transactionId,
    blockchainReference,
    providerReference
  } = getTransactionReferenceParts(tx)

  if (blockchainReference) return blockchainReference
  if (providerReference) return providerReference

  if (tx.provider === "cash") {
    return `Cash payment · ${shortReferenceId(paymentId || transactionId) || "local"}`
  }

  if (paymentId) {
    return `Payment request · ${shortReferenceId(paymentId)}`
  }

  if (transactionId) {
    return `Transaction · ${shortReferenceId(transactionId)}`
  }

  return "Local payment"
}
