import type { PaymentEvent } from "@/database/paymentEvents"
import type { Payment } from "@/database/payments"
import type { Transaction } from "@/database/transactions"

type StatusMetadata = {
  providerEvent?: string
  rawPayload?: unknown
}

const PROCESSING_EVENT_TYPES = new Set([
  "payment.processing",
  "payment.confirmed",
  "payment.failed"
])

const EVIDENCE_KEYS = new Set([
  "txhash",
  "transactionhash",
  "transactionid",
  "signature",
  "providersignature",
  "providertransactionid",
  "providerreference",
  "invoiceid",
  "invoice",
  "chargeid",
  "paymenthash",
  "lightningpaymenthash",
  "lightninginvoice"
])

function hasEvidenceValue(value: unknown): boolean {
  return String(value || "").trim().length > 0
}

export function metadataHasPaymentEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false

  const stack: unknown[] = [value]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== "object") continue

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const normalizedKey = key.replace(/[_-]+/g, "").toLowerCase()
      if (EVIDENCE_KEYS.has(normalizedKey) && hasEvidenceValue(raw)) {
        return true
      }
      if (raw && typeof raw === "object") stack.push(raw)
    }
  }

  return false
}

export function paymentHasProcessingEvidence(input: {
  payment: Pick<Payment, "provider_reference" | "metadata">
  transaction?: Pick<Transaction, "provider_transaction_id"> | null
  events?: Array<Pick<PaymentEvent, "event_type" | "raw_payload">>
}): boolean {
  if (hasEvidenceValue(input.payment.provider_reference)) return true
  if (hasEvidenceValue(input.transaction?.provider_transaction_id)) return true
  if (metadataHasPaymentEvidence(input.payment.metadata)) return true

  return (input.events || []).some((event) => {
    if (PROCESSING_EVENT_TYPES.has(String(event.event_type || ""))) return true
    return metadataHasPaymentEvidence(event.raw_payload)
  })
}

export function hasFailureEvidence(metadata?: StatusMetadata): boolean {
  const providerEvent = String(metadata?.providerEvent || "").toLowerCase()
  if (providerEvent.includes("user_rejected") || providerEvent.includes("cancel")) {
    return false
  }
  if (
    providerEvent.includes("failed") ||
    providerEvent.includes("failure") ||
    providerEvent.includes("revert") ||
    providerEvent.includes("rejected")
  ) {
    return true
  }

  const payload = metadata?.rawPayload
  if (!payload || typeof payload !== "object") return false

  const stack: unknown[] = [payload]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== "object") continue

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const normalizedKey = key.replace(/[_-]+/g, "").toLowerCase()
      const normalizedValue = String(raw || "").toLowerCase()
      if (
        normalizedKey === "failureevidence" ||
        normalizedKey === "transactionerror" ||
        normalizedKey === "receiptstatus" ||
        normalizedKey === "err"
      ) {
        if (
          raw === true ||
          normalizedValue === "0x0" ||
          normalizedValue === "0" ||
          normalizedValue.includes("fail") ||
          normalizedValue.includes("err")
        ) {
          return true
        }
      }
      if (raw && typeof raw === "object") stack.push(raw)
    }
  }

  return false
}

export function isExplicitUnpaidInvoiceExpiry(metadata?: StatusMetadata): boolean {
  const providerEvent = String(metadata?.providerEvent || "").toLowerCase()
  return (
    providerEvent.includes("invoice_expired") ||
    providerEvent.includes("invoice.expired") ||
    providerEvent.includes("payment.expired") ||
    providerEvent.includes("checkout_session.expired")
  )
}
