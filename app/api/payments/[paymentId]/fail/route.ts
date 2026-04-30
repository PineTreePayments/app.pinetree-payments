import { NextRequest } from "next/server"
import { getPaymentById } from "@/database"
import { failPayment, expirePayment, updatePaymentStatus } from "@/engine/updatePaymentStatus"
import { normalizeToStrictPaymentStatus } from "@/engine/paymentStateMachine"

export async function POST(
  _req: NextRequest,
  { params }: { params: { paymentId: string } }
) {
  const paymentId = String(params.paymentId || "").trim()

  if (!paymentId) {
    return new Response(JSON.stringify({ error: "Missing paymentId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    const payment = await getPaymentById(paymentId)
    if (!payment) {
      return new Response(JSON.stringify({ error: "Payment not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }

    const status = normalizeToStrictPaymentStatus(payment.status)

    // Already terminal — idempotent
    if (status === "CONFIRMED" || status === "FAILED" || status === "INCOMPLETE") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // State machine: FAILED is only reachable from PROCESSING.
    // CREATED/PENDING → INCOMPLETE (the cancelled terminal state).
    if (status === "PROCESSING") {
      await failPayment(paymentId, { providerEvent: "payment.user_rejected" })
    } else if (status === "PENDING") {
      await expirePayment(paymentId, { providerEvent: "payment.user_rejected" })
    } else {
      // CREATED → PENDING → INCOMPLETE (two hops required by state machine)
      await updatePaymentStatus(paymentId, "PENDING")
      await expirePayment(paymentId, { providerEvent: "payment.user_rejected" })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel payment"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
