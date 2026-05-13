import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { createCheckoutSessionEngine } from "@/engine/checkoutSessions"

type SessionBody = {
  amount: number
  currency?: string
  orderId?: string
  customerEmail?: string
  description?: string
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as SessionBody

    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
    }

    const session = await createCheckoutSessionEngine({
      merchantId,
      amount,
      currency: body.currency,
      orderId: body.orderId ? String(body.orderId).trim() : undefined,
      customerEmail: body.customerEmail ? String(body.customerEmail).trim() : undefined,
      description: body.description ? String(body.description).trim() : undefined,
      successUrl: body.successUrl ? String(body.successUrl).trim() : undefined,
      cancelUrl: body.cancelUrl ? String(body.cancelUrl).trim() : undefined,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : undefined,
    })

    return NextResponse.json({ session }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create checkout session"
    const isValidation =
      message === "Invalid amount" ||
      message.startsWith("successUrl") ||
      message.startsWith("cancelUrl") ||
      message === "Missing merchant ID"
    return NextResponse.json(
      { error: message },
      { status: isValidation ? 400 : getRouteErrorStatus(error) }
    )
  }
}
