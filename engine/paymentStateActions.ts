import { getPaymentById } from "@/database"
import { updatePaymentStatus } from "./updatePaymentStatus"

/**
 * Mark a payment as incomplete/abandoned.
 *
 * Silently skips terminal states (CONFIRMED, FAILED, INCOMPLETE) and CREATED payments —
 * only advances a PENDING payment to INCOMPLETE. Swallows invalid-transition errors so
 * callers (e.g. network-switch flow) are safe to call this fire-and-forget.
 */
export async function markPaymentIncomplete(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
): Promise<void> {
  try {
    const payment = await getPaymentById(paymentId)
    if (!payment) return

    const status = String(payment.status || "").toUpperCase()
    if (["CONFIRMED", "FAILED", "INCOMPLETE"].includes(status)) return
    if (status !== "PENDING") return

    await updatePaymentStatus(paymentId, "INCOMPLETE", metadata)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("Invalid payment transition")) throw error
  }
}
