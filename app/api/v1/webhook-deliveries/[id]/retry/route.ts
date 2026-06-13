import { NextRequest, NextResponse } from "next/server"
import { normalizePublicWebhookDelivery } from "@/engine/publicWebhookDeliveries"
import { retryWebhookDelivery } from "@/engine/webhookDelivery"
import { requireV1MerchantApiKey } from "@/lib/api/v1/auth"
import { getV1RequestId, V1ApiError, v1ErrorResponse } from "@/lib/api/v1/errors"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getV1RequestId(req)
  try {
    const { merchantId } = await requireV1MerchantApiKey(req, "webhooks:write")
    const { id } = await params
    const delivery = id ? await retryWebhookDelivery(merchantId, id) : null
    if (!delivery) {
      throw new V1ApiError({
        status: 404,
        type: "not_found_error",
        code: "webhook_delivery_not_found",
        message: "No webhook delivery was found for the provided ID.",
      })
    }
    return NextResponse.json(normalizePublicWebhookDelivery(delivery), {
      headers: { "X-Request-Id": requestId },
    })
  } catch (error) {
    return v1ErrorResponse(error, requestId)
  }
}
