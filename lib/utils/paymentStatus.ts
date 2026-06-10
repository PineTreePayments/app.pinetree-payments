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
  | "success"
  | "failed"
  | "incomplete"
  | "expired"

export type PaymentStatusIcon = "clock" | "spinner" | "check-circle" | "x-circle" | "minus"

export type PaymentDisplayStatus = {
  status: string
  label: "Waiting" | "Processing" | "Success" | "Failed" | "Incomplete" | "Expired"
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
    classes: "border border-gray-200 bg-gray-100 text-gray-700",
    iconClassName: "text-gray-500",
    iconBgClassName: "bg-gray-100",
  },
  processing: {
    label: "Processing",
    message: "Payment detected and awaiting confirmation.",
    tone: "processing",
    icon: "spinner",
    classes: "border border-blue-200 bg-blue-100 text-blue-800",
    iconClassName: "text-blue-600",
    iconBgClassName: "bg-blue-50",
    spin: true,
  },
  success: {
    label: "Success",
    message: "Payment successfully completed.",
    tone: "success",
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
    message: "Customer left the payment or switched payment methods before sending funds.",
    tone: "incomplete",
    icon: "minus",
    classes: "border border-gray-200 bg-gray-100 text-gray-700",
    iconClassName: "text-gray-500",
    iconBgClassName: "bg-gray-100",
  },
  expired: {
    label: "Expired",
    message: "The payment request timed out naturally.",
    tone: "expired",
    icon: "clock",
    classes: "border border-amber-200 bg-amber-100 text-amber-800",
    iconClassName: "text-amber-600",
    iconBgClassName: "bg-amber-50",
  },
}

function displayToneForStatus(normalizedStatus: string): PaymentStatusTone {
  if (["CREATED", "PENDING", "WAITING", "AWAITING_CUSTOMER"].includes(normalizedStatus)) {
    return "waiting"
  }
  if (["PROCESSING", "IN_PROGRESS", "SETTLING"].includes(normalizedStatus)) {
    return "processing"
  }
  if (["CONFIRMED", "SUCCESS", "SUCCEEDED", "COMPLETE", "COMPLETED", "PAID"].includes(normalizedStatus)) {
    return "success"
  }
  if (["FAILED", "ERROR", "REJECTED", "DECLINED", "DENIED"].includes(normalizedStatus)) {
    return "failed"
  }
  if (["INCOMPLETE", "CANCELED", "CANCELLED", "ABANDONED"].includes(normalizedStatus)) {
    return "incomplete"
  }
  if (["EXPIRED", "TIMED_OUT", "TIMEOUT"].includes(normalizedStatus)) {
    return "expired"
  }
  return "waiting"
}

export function getPaymentDisplayStatus(status: string | null | undefined): PaymentDisplayStatus {
  const normalizedStatus = String(status || "PENDING").trim().toUpperCase().replace(/[\s-]+/g, "_")
  const config = STATUS_DISPLAY[displayToneForStatus(normalizedStatus)]
  return { status: normalizedStatus, ...config }
}

export function getPaymentStatusLabel(status: string | null | undefined) {
  return getPaymentDisplayStatus(status).label
}
