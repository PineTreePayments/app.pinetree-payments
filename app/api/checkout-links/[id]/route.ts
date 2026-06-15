import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { archiveCheckoutLinkEngine, disableCheckoutLinkEngine } from "@/engine/checkoutLinks"

type PatchBody = {
  status?: "disabled" | "archived"
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await params
    const body = (await req.json()) as PatchBody

    if (body.status !== "disabled" && body.status !== "archived") {
      return NextResponse.json(
        { error: "Only status: disabled or archived is supported" },
        { status: 400 }
      )
    }

    const link =
      body.status === "archived"
        ? await archiveCheckoutLinkEngine(id, merchantId)
        : await disableCheckoutLinkEngine(id, merchantId)
    return NextResponse.json({ link })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update checkout link" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
