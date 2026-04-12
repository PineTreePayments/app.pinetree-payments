/**
 * Shared payment status formatting utility
 * Single source of truth for ALL status rendering across the entire application
 * 
 * ALL payment states are defined here exactly once.
 * Every UI surface uses this exact same mapping.
 */

export type PaymentDisplayStatus = {
  status: string
  classes: string
  label: string
}

export function getPaymentDisplayStatus(status: string, createdAt: string): PaymentDisplayStatus {
  const txDate = new Date(createdAt)
  const now = new Date()
  const ageMinutes = (now.getTime() - txDate.getTime()) / (1000 * 60)

  // Only expire PENDING status after 5 minutes. PROCESSING never expires.
  const effectiveStatus = status === "PENDING" && ageMinutes > 5
    ? "EXPIRED"
    : status

  const statusMappings: Record<string, PaymentDisplayStatus> = {
    CREATED: { status: "CREATED", classes: "bg-slate-100 text-slate-700", label: "Created" },
    PENDING: { status: "PENDING", classes: "bg-amber-100 text-amber-800", label: "Waiting for payment" },
    PROCESSING: { status: "PROCESSING", classes: "bg-blue-100 text-blue-800", label: "Confirming" },
    CONFIRMED: { status: "CONFIRMED", classes: "bg-green-100 text-green-800", label: "Confirmed" },
    FAILED: { status: "FAILED", classes: "bg-red-100 text-red-800", label: "Failed" },
    EXPIRED: { status: "EXPIRED", classes: "bg-gray-100 text-gray-700", label: "Expired" },
    INCOMPLETE: { status: "INCOMPLETE", classes: "bg-orange-100 text-orange-800", label: "Incomplete" },
    CANCELED: { status: "CANCELED", classes: "bg-red-100 text-red-700", label: "Canceled" },
  }

  return statusMappings[effectiveStatus] || {
    status: effectiveStatus,
    classes: "bg-gray-100 text-gray-700",
    label: effectiveStatus
  }
}
