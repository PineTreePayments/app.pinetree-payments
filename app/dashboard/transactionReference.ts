import { formatDashboardProvider } from "@/components/dashboard/displayHelpers"

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

export function transactionReferenceProviderName(provider: string | null | undefined) {
  const normalized = firstReferenceValue(provider)?.toLowerCase()
  if (!normalized) return null
  if (normalized === "cash") return "Cash payment"

  const displayName = formatDashboardProvider(normalized)
  return displayName === "-" ? null : displayName
}

export function formatProviderReference(
  provider: string | null | undefined,
  reference: string | null | undefined
) {
  const providerName = transactionReferenceProviderName(provider)
  const normalizedReference = firstReferenceValue(reference)

  if (providerName && normalizedReference) {
    return `${providerName} \u00b7 ${normalizedReference}`
  }

  return normalizedReference || providerName
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

  const directReference = blockchainReference || providerReference
  if (directReference) return formatProviderReference(tx.provider, directReference) || directReference

  if (firstReferenceValue(tx.provider)?.toLowerCase() === "cash") {
    return formatProviderReference("cash", shortReferenceId(paymentId || transactionId) || "local") || "Cash payment"
  }

  if (paymentId) {
    return formatProviderReference(tx.provider, shortReferenceId(paymentId))
      || `Payment request \u00b7 ${shortReferenceId(paymentId)}`
  }

  if (transactionId) {
    return formatProviderReference(tx.provider, shortReferenceId(transactionId))
      || `Transaction \u00b7 ${shortReferenceId(transactionId)}`
  }

  return transactionReferenceProviderName(tx.provider) || "Local payment"
}
