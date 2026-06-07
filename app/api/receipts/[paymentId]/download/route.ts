import { NextRequest, NextResponse } from "next/server"
import { getMerchantReceipt, renderReceiptPdf } from "@/engine/receipts"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { paymentId } = await context.params
    const receipt = await getMerchantReceipt(merchantId, paymentId)
    const pdf = await renderReceiptPdf(receipt)
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="pinetree-receipt-${paymentId}.pdf"`
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download receipt"
    const status = message === "Payment not found" ? 404 :
      message.includes("after payment confirmation") ? 409 :
      getRouteErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
