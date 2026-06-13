import { NextRequest, NextResponse } from "next/server"
import { getPublicPayment } from "@/engine/publicPayments"
import { requireV1MerchantApiKey } from "@/lib/api/v1/auth"
import { getV1RequestId, V1ApiError, v1ErrorResponse } from "@/lib/api/v1/errors"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getV1RequestId(req)
  try {
    const { merchantId } = await requireV1MerchantApiKey(req, "payments:read")
    const { id } = await params
    const payment = id ? await getPublicPayment(merchantId, id) : null
    if (!payment) {
      throw new V1ApiError({
        status: 404,
        type: "not_found_error",
        code: "payment_not_found",
        message: "No payment was found for the provided ID.",
      })
    }
    return NextResponse.json(payment, {
      headers: { "X-Request-Id": requestId },
    })
  } catch (error) {
    return v1ErrorResponse(error, requestId)
  }
}
