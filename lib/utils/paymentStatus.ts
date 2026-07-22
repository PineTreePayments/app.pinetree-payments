/**
 * Central payment status presentation model.
 *
 * This module never mutates or infers engine/database state. It only translates
 * stored or provider-facing status strings into PineTree's shared display
 * language. Engine code must continue to use the original stored values.
 */

export type PaymentStatusTone =
  | "waiting"
  | "processing"
  | "confirmed"
  | "failed"
  | "incomplete"
  | "expired"
  | "canceled"
  | "refunded"
  | "disputed"
  | "unknown"

export type PaymentStatusIcon = "clock" | "spinner" | "check-circle" | "x-circle" | "refund" | "alert-triangle" | "minus"

export type PaymentDisplayStatus = {
  status: string
  label: "Waiting" | "Processing" | "Confirmed" | "Failed" | "Incomplete" | "Action required" | "Expired" | "Canceled" | "Refunded" | "Disputed" | "Unknown"
  message: string
  tone: PaymentStatusTone
  icon: PaymentStatusIcon
  classes: string
  iconClassName: string
  iconBgClassName: string
  spin?: boolean
}

const STATUS_DISPLAY: Record<PaymentStatusTone, Omit<PaymentDisplayStatus, "status">> = {
  waiting: {
    label: "Waiting",
    message: "Payment request created and awaiting customer action.",
    tone: "waiting",
    icon: "clock",
    classes: "border border-blue-200 bg-blue-50 text-blue-800",
    iconClassName: "text-[#2f5bea]",
    iconBgClassName: "bg-transparent",
  },
  processing: {
    label: "Processing",
    message: "Payment detected and awaiting confirmation.",
    tone: "processing",
    icon: "spinner",
    classes: "border border-blue-300 bg-blue-200 text-blue-900",
    iconClassName: "text-blue-700",
    iconBgClassName: "bg-blue-100",
    spin: true,
  },
  confirmed: {
    label: "Confirmed",
    message: "Payment successfully completed.",
    tone: "confirmed",
    icon: "check-circle",
    classes: "border border-green-200 bg-green-100 text-green-800",
    iconClassName: "text-green-600",
    iconBgClassName: "bg-green-50",
  },
  failed: {
    label: "Failed",
    message: "Payment attempt failed validation, was rejected, or could not complete.",
    tone: "failed",
    icon: "x-circle",
    classes: "border border-red-200 bg-red-100 text-red-800",
    iconClassName: "text-red-600",
    iconBgClassName: "bg-red-50",
  },
  incomplete: {
    label: "Incomplete",
    message: "The payment was not completed before the request ended.",
    tone: "incomplete",
    icon: "alert-triangle",
    classes: "border border-amber-200 bg-amber-100 text-amber-900",
    iconClassName: "text-amber-700",
    iconBgClassName: "bg-amber-50",
  },
  expired: {
    label: "Expired",
    message: "The payment request timed out naturally.",
    tone: "expired",
    icon: "alert-triangle",
    classes: "border border-amber-200 bg-amber-100 text-amber-900",
    iconClassName: "text-amber-700",
    iconBgClassName: "bg-amber-50",
  },
  canceled: {
    label: "Canceled",
    message: "The payment was canceled before completion.",
    tone: "canceled",
    icon: "x-circle",
    classes: "border border-gray-300 bg-gray-100 text-gray-800",
    iconClassName: "text-gray-600",
    iconBgClassName: "bg-gray-50",
  },
  refunded: {
    label: "Refunded",
    message: "The settled payment was returned to the customer.",
    tone: "refunded",
    icon: "refund",
    classes: "border border-orange-200 bg-orange-100 text-orange-800",
    iconClassName: "text-orange-700",
    iconBgClassName: "bg-orange-50",
  },
  disputed: {
    label: "Disputed",
    message: "The payment is under dispute.",
    tone: "disputed",
    icon: "alert-triangle",
    classes: "border border-amber-200 bg-amber-100 text-amber-900",
    iconClassName: "text-amber-700",
    iconBgClassName: "bg-amber-50",
  },
  unknown: {
    label: "Unknown",
    message: "The payment status is not recognized.",
    tone: "unknown",
    icon: "minus",
    classes: "border border-gray-300 bg-gray-100 text-gray-800",
    iconClassName: "text-gray-600",
    iconBgClassName: "bg-gray-50",
  },
}

function displayToneForStatus(normalizedStatus: string): PaymentStatusTone {
  if ([
    "CREATED", "PENDING", "WAITING", "AWAITING_CUSTOMER", "DRAFT",
    "AWAITING_CONFIRMATION", "AWAITING_APPROVAL", "REVIEW_REQUIRED"
  ].includes(normalizedStatus)) {
    return "waiting"
  }
  if ([
    "PROCESSING", "IN_PROGRESS", "SETTLING", "SUBMITTED", "SENT",
    "READY_TO_SUBMIT", "PREPARED", "AWAITING_SIGNATURE", "PAYOUT_INITIATED"
  ].includes(normalizedStatus)) {
    return "processing"
  }
  if (["CONFIRMED", "SUCCESS", "SUCCEEDED", "COMPLETE", "COMPLETED", "PAID"].includes(normalizedStatus)) {
    return "confirmed"
  }
  if (["FAILED", "ERROR", "REJECTED", "DECLINED", "DENIED", "VALIDATION_FAILED", "BLOCKED"].includes(normalizedStatus)) {
    return "failed"
  }
  if (["INCOMPLETE", "ABANDONED", "REQUIRES_ACTION", "ACTION_REQUIRED"].includes(normalizedStatus)) {
    return "incomplete"
  }
  if (["CANCELED", "CANCELLED"].includes(normalizedStatus)) return "canceled"
  if (["EXPIRED", "TIMED_OUT", "TIMEOUT"].includes(normalizedStatus)) {
    return "expired"
  }
  if (["REFUNDED", "REFUND_COMPLETE", "REFUND_COMPLETED"].includes(normalizedStatus)) return "refunded"
  if (["DISPUTED", "CHARGEBACK"].includes(normalizedStatus)) return "disputed"
  return "unknown"
}

export function getPaymentDisplayStatus(status: string | null | undefined): PaymentDisplayStatus {
  const normalizedStatus = String(status || "UNKNOWN").trim().toUpperCase().replace(/[\s-]+/g, "_")
  const config = STATUS_DISPLAY[displayToneForStatus(normalizedStatus)]
  if (normalizedStatus === "REQUIRES_ACTION" || normalizedStatus === "ACTION_REQUIRED") {
    return {
      status: normalizedStatus,
      ...config,
      label: "Action required",
      message: "Manual review is needed before this wallet operation can be retried.",
    }
  }
  return { status: normalizedStatus, ...config }
}

export function getPaymentStatusLabel(status: string | null | undefined) {
  return getPaymentDisplayStatus(status).label
}
