import { NextRequest, NextResponse } from "next/server"
import { listPublicWebhookDeliveries } from "@/engine/publicWebhookDeliveries"
import { requireV1MerchantApiKey } from "@/lib/api/v1/auth"
import { getV1RequestId, v1ErrorResponse } from "@/lib/api/v1/errors"
import { parseWebhookDeliveryListQuery } from "@/lib/api/v1/webhookDeliveryList"

export async function GET(req: NextRequest) {
  const requestId = getV1RequestId(req)
  try {
    const { merchantId } = await requireV1MerchantApiKey(req, "webhooks:read")
    const filters = parseWebhookDeliveryListQuery(req.url)
    const result = await listPublicWebhookDeliveries({ merchantId, ...filters })
    return NextResponse.json(
      {
        object: "list",
        data: result.data,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      },
      { headers: { "X-Request-Id": requestId } }
    )
  } catch (error) {
    return v1ErrorResponse(error, requestId)
  }
}
