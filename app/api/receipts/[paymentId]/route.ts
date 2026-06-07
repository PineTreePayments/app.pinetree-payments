import { NextRequest, NextResponse } from "next/server"
import { getMerchantReceipt, renderReceiptHtml } from "@/engine/receipts"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { paymentId } = await context.params
    const receipt = await getMerchantReceipt(merchantId, paymentId)
    return new NextResponse(renderReceiptHtml(receipt), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load receipt"
    const status = message === "Payment not found" ? 404 :
      message.includes("after payment confirmation") ? 409 :
      getRouteErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
