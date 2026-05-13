import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { createCheckoutLinkEngine, listCheckoutLinksEngine } from "@/engine/checkoutLinks"
import type { CheckoutLinkExpiration } from "@/engine/checkoutLinks"

type CreateCheckoutLinkBody = {
  name: string
  amount: number
  description?: string
  customerEmail?: string
  reference?: string
  expiration?: CheckoutLinkExpiration
  currency?: string
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const links = await listCheckoutLinksEngine(merchantId)
    return NextResponse.json({ links })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch checkout links" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as CreateCheckoutLinkBody

    const link = await createCheckoutLinkEngine({
      merchantId,
      name: String(body.name || "").trim(),
      amount: Number(body.amount),
      description: body.description,
      customerEmail: body.customerEmail,
      reference: body.reference,
      expiration: body.expiration ?? "never",
      currency: body.currency,
    })

    return NextResponse.json({ link }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create checkout link"
    const status =
      message === "Invalid amount" ||
      message === "Link name is required" ||
      message === "Missing merchant ID"
        ? 400
        : getRouteErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
