import { NextRequest } from "next/server"
import { getPaymentById, getPaymentIntentById } from "@/database"
import { failPayment, expirePayment, updatePaymentStatus } from "@/engine/updatePaymentStatus"
import { normalizeToStrictPaymentStatus } from "@/engine/paymentStateMachine"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { verifyTerminalSession } from "@/lib/api/terminalAuth"
import { verifyCheckoutSession } from "@/lib/api/checkoutAuth"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId: rawPaymentId } = await context.params
  const paymentId = String(rawPaymentId || "").trim()

  if (!paymentId) {
    return json({ error: "Missing paymentId" }, 400)
  }

  // ── Auth: three valid paths ────────────────────────────────────────────────
  // 1. Terminal session (pts_) — POS terminal identified by verified token claims
  // 2. Checkout session (pco_) — customer-scoped token tied to the intent that
  //    created this payment; only authorises safe cancellation for that payment
  // 3. Merchant auth (Supabase session or pt_live_ API key) — full merchant access
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""

  if (!token) {
    return json({ error: "Unauthorized" }, 401)
  }

  let authenticatedMerchantId: string | null = null
  let checkoutIntentId: string | null = null

  if (token.startsWith("pts_")) {
    let claims
    try {
      claims = verifyTerminalSession(token)
    } catch {
      return json({ error: "Invalid or expired terminal session" }, 401)
    }
    authenticatedMerchantId = claims.mid
  } else if (token.startsWith("pco_")) {
    let claims
    try {
      claims = verifyCheckoutSession(token)
    } catch {
      return json({ error: "Invalid or expired checkout session" }, 401)
    }
    checkoutIntentId = claims.iid
  } else {
    try {
      authenticatedMerchantId = await requireMerchantIdFromRequest(req)
    } catch {
      return json({ error: "Unauthorized" }, 401)
    }
  }

  try {
    const payment = await getPaymentById(paymentId)
    if (!payment) {
      return json({ error: "Payment not found" }, 404)
    }

    // ── Ownership / scope check ────────────────────────────────────────────────
    if (authenticatedMerchantId !== null) {
      // Terminal session or merchant auth: verify the payment belongs to this merchant
      const paymentMerchantId = (payment as Record<string, unknown>).merchant_id
      if (!paymentMerchantId || paymentMerchantId !== authenticatedMerchantId) {
        return json({ error: "Forbidden" }, 403)
      }
    } else if (checkoutIntentId !== null) {
      // Checkout session: verify this payment was created by the scoped intent.
      // The engine created the payment; the intent row records which payment_id it
      // produced.  A token for intent X cannot cancel a payment from intent Y.
      const intent = await getPaymentIntentById(checkoutIntentId)
      if (!intent || String(intent.payment_id || "") !== paymentId) {
        return json({ error: "Checkout session is not authorized for this payment" }, 403)
      }
    }

    const status = normalizeToStrictPaymentStatus(payment.status)

    // Already terminal — idempotent
    if (status === "CONFIRMED" || status === "FAILED" || status === "INCOMPLETE") {
      return json({ ok: true })
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

    return json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel payment"
    return json({ error: message }, 500)
  }
}
