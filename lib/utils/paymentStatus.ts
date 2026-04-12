/**
 * Shared payment status formatting utility
 * Single source of truth for ALL status rendering across the entire application
 */

export function getPaymentDisplayStatus(status: string, createdAt: string): {
  status: string
  classes: string
} {
  const txDate = new Date(createdAt)
  const now = new Date()
  const ageMinutes = (now.getTime() - txDate.getTime()) / (1000 * 60)

  // Only expire PENDING status after 5 minutes. PROCESSING never expires.
  const effectiveStatus = status === "PENDING" && ageMinutes > 5
    ? "EXPIRED"
    : status

  const statusClasses =
    effectiveStatus === "CONFIRMED"
      ? "bg-green-100 text-green-800"
      : effectiveStatus === "FAILED"
      ? "bg-red-100 text-red-800"
      : effectiveStatus === "EXPIRED"
      ? "bg-gray-100 text-gray-700"
      : effectiveStatus === "PROCESSING"
      ? "bg-blue-100 text-blue-800"
      : "bg-amber-100 text-amber-800"

  return {
    status: effectiveStatus,
    classes: statusClasses
  }
}