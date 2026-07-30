export type PublicCheckoutSessionStatus =
  | "open"
  | "processing"
  | "paid"
  | "failed"
  | "incomplete"
  | "expired"
  | "canceled"
  | "unknown"

export function mapInternalCheckoutSessionStatus(status: unknown): PublicCheckoutSessionStatus {
  const normalized = String(status || "").trim().toUpperCase()

  if (["CONFIRMED", "PAID", "SUCCESS", "SUCCEEDED"].includes(normalized)) return "paid"
  if (["PROCESSING", "IN_PROGRESS", "SETTLING"].includes(normalized)) return "processing"
  if (["FAILED", "ERROR", "REJECTED", "DECLINED"].includes(normalized)) return "failed"
  if (["EXPIRED", "TIMED_OUT", "TIMEOUT"].includes(normalized)) return "expired"
  if (normalized === "INCOMPLETE") return "incomplete"
  if (["DISABLED", "CANCELED", "CANCELLED"].includes(normalized)) return "canceled"
  if (["OPEN", "ACTIVE", "CREATED", "PENDING"].includes(normalized)) return "open"
  return "unknown"
}
