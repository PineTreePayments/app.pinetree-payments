import { NextRequest, NextResponse } from "next/server"
import { getPaymentById, getPaymentIntentById } from "@/database"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"
import {
  advancePaymentToTargetStatus,
  processPaymentEvent
} from "@/engine/eventProcessor"
import { verifyCheckoutSession } from "@/lib/api/checkoutAuth"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { isSpeedPaymentPaid, retrieveSpeedPayment } from "@/providers/lightning/speedClient"

type Params = { params: Promise<{ paymentId: string }> }

const TERMINAL_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])

export async function POST(req: NextRequest, { params }: Params) {
  const { paymentId: rawPaymentId } = await params
  const paymentId = String(rawPaymentId || "").trim()

  if (!paymentId) {
    return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
  }

  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  if (!token) {
    return NextResponse.json({ error: "Checkout session token required" }, { status: 401 })
  }

  let claims: ReturnType<typeof verifyCheckoutSession>
  try {
    claims = verifyCheckoutSession(token)
  } catch {
    return NextResponse.json({ error: "Invalid or expired checkout session" }, { status: 401 })
  }

  const intent = await getPaymentIntentById(claims.iid)
  if (!intent || String(intent.payment_id || "") !== paymentId) {
    return NextResponse.json({ error: "Checkout session is not authorized for this payment" }, { status: 403 })
  }

  const payment = await getPaymentById(paymentId)
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 })
  }

  const provider = String(payment.provider || "").toLowerCase()
  if (
    (provider !== "lightning_nwc" && provider !== SPEED_PROVIDER_NAME) ||
    String(payment.network || "").toLowerCase() !== "bitcoin_lightning"
  ) {
    return NextResponse.json({ error: "Payment is not a supported Bitcoin Lightning payment" }, { status: 400 })
  }

  const currentStatus = String(payment.status || "").toUpperCase()
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return NextResponse.json({
      checked: false,
      status: currentStatus
    })
  }

  if (provider === SPEED_PROVIDER_NAME) {
    const speedPaymentId = String(payment.provider_reference || "").trim()
    if (!speedPaymentId) {
      return NextResponse.json({ error: "Missing Speed payment reference" }, { status: 400 })
    }

    const speedPayment = await retrieveSpeedPayment(speedPaymentId)
    const detected = isSpeedPaymentPaid(speedPayment)
    const speedStatus = String(speedPayment.status || "").toLowerCase().trim()

    if (detected) {
      await processPaymentEvent({
        type: "payment.confirmed",
        paymentId,
        feeCaptureValidated: true
      })
    } else if (speedStatus === "processing" || speedStatus === "settling") {
      await processPaymentEvent({
        type: "payment.processing",
        paymentId
      })
    } else if (
      speedStatus === "expired" ||
      speedStatus === "cancelled" ||
      speedStatus === "canceled"
    ) {
      await advancePaymentToTargetStatus(paymentId, "INCOMPLETE", {
        providerEvent: "payment.expired",
        rawPayload: { speedPaymentId, speedStatus }
      })
    }

    const updatedPayment = await getPaymentById(paymentId)
    return NextResponse.json({
      checked: true,
      detected,
      speedStatus: String(speedPayment.status || ""),
      status: String(updatedPayment?.status || payment.status || "").toUpperCase()
    })
  }

  const detected = await runPaymentWatcher(paymentId)
  const updatedPayment = await getPaymentById(paymentId)

  return NextResponse.json({
    checked: true,
    detected,
    status: String(updatedPayment?.status || payment.status || "").toUpperCase()
  })
}
