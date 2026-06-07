/**
 * Shared payment status formatting utility.
 *
 * SOURCE-OF-TRUTH RULE:
 * Do not infer or mutate payment state in the presentation layer.
 * Stored ledger/payment status is the source of truth.
 * Stale transitions must be handled by PineTree Engine/sweep logic before reaching UI.
 *
 * This function maps stored status values to display labels and Tailwind classes.
 * It must not change the meaning of any status:
 *   - PENDING  → "Pending"    (never "Incomplete", never "Awaiting Customer" as a collapse)
 *   - CREATED  → "Created"    (never "Incomplete")
 *   - FAILED   → "Failed"     (never "Incomplete")
 *   - INCOMPLETE → "Incomplete" (only when the DB actually holds INCOMPLETE)
 * No age-based, timeout-based, or context-based overrides are permitted here.
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
