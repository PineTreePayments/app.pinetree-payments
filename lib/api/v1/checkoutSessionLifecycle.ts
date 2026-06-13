import { NextRequest, NextResponse } from "next/server"
import {
  CheckoutSessionLifecycleError,
  transitionCheckoutSessionLifecycle,
} from "@/engine/checkoutSessionLifecycle"
import type { CheckoutSessionLifecycle } from "@/engine/checkoutSessionMetadata"
import { requireV1MerchantApiKeyWithAnyPermission } from "./auth"
import { getV1RequestId, V1ApiError, v1ErrorResponse } from "./errors"

export async function handleCheckoutSessionLifecycle(
  req: NextRequest,
  params: Promise<{ id: string }>,
  lifecycle: CheckoutSessionLifecycle
) {
  const requestId = getV1RequestId(req)

  try {
    const { merchantId } = await requireV1MerchantApiKeyWithAnyPermission(req, [
      "checkout.sessions:write",
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

    const session = await transitionCheckoutSessionLifecycle({
      merchantId,
      sessionId: id,
      lifecycle,
    })
    return NextResponse.json(session, {
      headers: { "X-Request-Id": requestId },
    })
  } catch (error) {
    if (error instanceof CheckoutSessionLifecycleError) {
      if (error.reason === "not_found") {
        return v1ErrorResponse(
          new V1ApiError({
            status: 404,
            type: "not_found_error",
            code: "checkout_session_not_found",
            message: "No checkout session was found for the provided ID.",
          }),
          requestId
        )
      }
      return v1ErrorResponse(
        new V1ApiError({
          status: 409,
          type: "invalid_request_error",
          code:
            lifecycle === "canceled"
              ? "checkout_session_not_cancelable"
              : "checkout_session_not_expirable",
          message:
            lifecycle === "canceled"
              ? "The checkout session is not open and cannot be canceled."
              : "The checkout session is not open and cannot be expired.",
        }),
        requestId
      )
    }
    return v1ErrorResponse(error, requestId)
  }
}
