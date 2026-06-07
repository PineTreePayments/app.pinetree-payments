/**
 * Shared payment status formatting utility.
 *
 * This is display-only: it must never infer or replace a persisted lifecycle
 * state based on age or other client-side conditions.
 */

export type PaymentDisplayStatus = {
  status: string
  classes: string
  label: string
}

export function getPaymentDisplayStatus(status: string): PaymentDisplayStatus {
  const normalizedStatus = String(status || "UNKNOWN").trim().toUpperCase()
  const statusMappings: Record<string, PaymentDisplayStatus> = {
    CREATED: { status: "CREATED", classes: "bg-slate-100 text-slate-700", label: "Created" },
    PENDING: { status: "PENDING", classes: "bg-amber-100 text-amber-800", label: "Pending" },
    PROCESSING: { status: "PROCESSING", classes: "bg-blue-100 text-blue-800", label: "Processing" },
    CONFIRMED: { status: "CONFIRMED", classes: "bg-green-100 text-green-800", label: "Confirmed" },
    FAILED: { status: "FAILED", classes: "bg-red-100 text-red-800", label: "Failed" },
    INCOMPLETE: { status: "INCOMPLETE", classes: "bg-orange-100 text-orange-800", label: "Incomplete" },
    EXPIRED: { status: "EXPIRED", classes: "bg-orange-100 text-orange-700", label: "Expired" },
    CANCELLED: { status: "CANCELLED", classes: "bg-red-100 text-red-700", label: "Cancelled" },
    CANCELED: { status: "CANCELED", classes: "bg-red-100 text-red-700", label: "Canceled" },
    REFUNDED: { status: "REFUNDED", classes: "bg-purple-100 text-purple-800", label: "Refunded" },
  }

  return statusMappings[normalizedStatus] || {
    status: normalizedStatus,
    classes: "bg-amber-100 text-amber-700",
    label: normalizedStatus
  }
}
