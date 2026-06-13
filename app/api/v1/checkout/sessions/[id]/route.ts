import { NextRequest, NextResponse } from "next/server"
import { getPublicCheckoutSession } from "@/engine/publicCheckoutSessions"
import { requireV1MerchantApiKeyWithAnyPermission } from "@/lib/api/v1/auth"
import { getV1RequestId, V1ApiError, v1ErrorResponse } from "@/lib/api/v1/errors"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getV1RequestId(req)

  try {
    // Existing create-only keys retain retrieval access during the read-scope transition.
    const { merchantId } = await requireV1MerchantApiKeyWithAnyPermission(req, [
      "checkout.sessions:read",
      "checkout.sessions:create",
    ])
    const { id } = await params
    if (!id) {
      throw new V1ApiError({
        status: 400,
        type: "invalid_request_error",
        code: "missing_session_id",
        message: "A checkout session ID is required.",
      })
    }

    const session = await getPublicCheckoutSession(merchantId, id)
    if (!session) {
      throw new V1ApiError({
        status: 404,
        type: "not_found_error",
        code: "checkout_session_not_found",
        message: "No checkout session was found for the provided ID.",
      })
    }

    return NextResponse.json(session, {
      headers: { "X-Request-Id": requestId },
    })
  } catch (error) {
    return v1ErrorResponse(error, requestId)
  }
}
