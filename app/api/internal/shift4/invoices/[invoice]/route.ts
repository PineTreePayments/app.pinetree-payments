import { NextRequest } from "next/server"
import { getShift4PaymentAttemptByInvoice } from "@/database/shift4PaymentAttempts"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, context: { params: Promise<{ invoice: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "payments:read")
    const invoice = decodeURIComponent((await context.params).invoice).trim()
    if (!invoice) throw Object.assign(new Error("invoice is required"), { status: 400, code: "invalid_request" })
    const attempt = await getShift4PaymentAttemptByInvoice(merchantId, invoice)
    if (!attempt) throw Object.assign(new Error("Shift4 invoice not found"), { status: 404, code: "not_found" })
    return shift4Success(attempt)
  } catch (error) {
    return shift4Error(error, "Unable to load Shift4 invoice evidence")
  }
}
