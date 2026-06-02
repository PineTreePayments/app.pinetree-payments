/**
 * POST /api/payments
 *
 * Canonical payment creation endpoint.
 * Strict flow: UI -> /api/payments -> engine/createPayment
 *
 * Auth: requires one of —
 *   • Terminal session token (pts_…) — merchantId and terminalId derived from token claims
 *   • Merchant auth (Supabase session or pt_live_… API key) — terminalId accepted from body
 */

import { NextRequest, NextResponse } from "next/server"
import { buildCreatePaymentRequest, createPayment } from "@/engine/createPayment"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { verifyTerminalSession } from "@/lib/api/terminalAuth"
import { getSafeSpeedCustomerErrorMessage } from "@/providers/lightning/speedClient"

type CreatePaymentBody = {
  amount: number
  currency: string
  preferredNetwork?: "solana" | "base" | "ethereum"
  terminalId?: string
  metadata?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreatePaymentBody & { merchantId?: unknown }

    const authHeader = req.headers.get("authorization") ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""

    let merchantId: string
    let resolvedTerminalId = body.terminalId

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (token.startsWith("pts_")) {
      // Terminal session path — derive both merchantId and terminalId from verified token
      let claims
      try {
        claims = verifyTerminalSession(token)
      } catch {
        return NextResponse.json({ error: "Invalid or expired terminal session" }, { status: 401 })
      }
      merchantId = claims.mid
      resolvedTerminalId = claims.tid
    } else {
      // Merchant auth path (Supabase session or API key)
      merchantId = await requireMerchantIdFromRequest(req)
    }

    const idempotencyKey = req.headers.get("idempotency-key") || undefined

    const { createPaymentInput, breakdown } = await buildCreatePaymentRequest({
      amount: body.amount,
      currency: body.currency,
      merchantId,
      preferredNetwork: body.preferredNetwork,
      terminalId: resolvedTerminalId,
      metadata: body.metadata
    })

    const payment = await createPayment({
      ...createPaymentInput,
      idempotencyKey
    })

    // Fire-and-forget: kick off an immediate blockchain check without blocking
    // the response. Serverless functions must exit promptly; the cron handles
    // subsequent periodic checks. runPaymentWatcher never throws.
    void runPaymentWatcher(payment.id)

    return NextResponse.json({
      paymentId: payment.id,
      provider: payment.provider,
      paymentUrl: payment.paymentUrl,
      qrCodeUrl: payment.qrCodeUrl,
      breakdown
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Payment creation failed"
    const safeSpeedMessage = getSafeSpeedCustomerErrorMessage(error)
    const status =
      getRouteErrorStatus(error) !== 500
        ? getRouteErrorStatus(error)
        : message === "Missing required payment fields" ||
          message === "Invalid payment amount" ||
          message.includes("No healthy payment adapter available")
          ? 400
          : 500

    return NextResponse.json(
      { error: "Payment creation failed", details: safeSpeedMessage || message },
      { status }
    )
  }
}
