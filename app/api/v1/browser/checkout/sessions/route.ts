import { NextRequest, NextResponse } from "next/server"
import { createCheckoutSessionEngine } from "@/engine/checkoutSessions"
import {
  CHECKOUT_SESSION_RAILS_METADATA_KEY,
  normalizeCheckoutSessionRails,
} from "@/engine/checkoutSessionMetadata"
import { getPublicCheckoutSession } from "@/engine/publicCheckoutSessions"
import { verifyMerchantPublicKey } from "@/engine/merchantPublicKeys"
import { getV1RequestId, V1ApiError, v1ErrorResponse } from "@/lib/api/v1/errors"
import { deliverV1CheckoutSessionWebhook } from "@/engine/webhookDelivery"

type CreateSessionBody = {
  amount?: unknown
  currency?: unknown
  reference?: unknown
  customer?: { email?: unknown } | null
  successUrl?: unknown
  cancelUrl?: unknown
  metadata?: unknown
  rails?: unknown
}

function optionalString(value: unknown) {
  if (value === undefined || value === null) return undefined
  return String(value).trim() || undefined
}

export async function POST(req: NextRequest) {
  const requestId = getV1RequestId(req)
  try {
    const publicKeyHeader = req.headers.get("x-pinetree-public-key")?.trim()
    if (!publicKeyHeader) {
      throw new V1ApiError({
        status: 401,
        type: "authentication_error",
        code: "missing_public_key",
        message: "The X-PineTree-Public-Key header is required.",
      })
    }

    const verified = await verifyMerchantPublicKey(publicKeyHeader)
    if (!verified) {
      throw new V1ApiError({
        status: 401,
        type: "authentication_error",
        code: "invalid_public_key",
        message: "The provided public key is invalid or has been disabled.",
      })
    }

    const { merchantId } = verified

    let body: CreateSessionBody
    try {
      body = (await req.json()) as CreateSessionBody
    } catch {
      throw new V1ApiError({
        status: 400,
        type: "invalid_request_error",
        code: "invalid_json",
        message: "The request body must be valid JSON.",
      })
    }

    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new V1ApiError({
        status: 400,
        type: "invalid_request_error",
        code: "invalid_amount",
        message: "amount must be greater than zero.",
      })
    }

    if (
      body.customer !== undefined &&
      body.customer !== null &&
      (typeof body.customer !== "object" || Array.isArray(body.customer))
    ) {
      throw new V1ApiError({
        status: 400,
        type: "invalid_request_error",
        code: "invalid_customer",
        message: "customer must be an object.",
      })
    }

    if (
      body.metadata !== undefined &&
      (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))
    ) {
      throw new V1ApiError({
        status: 400,
        type: "invalid_request_error",
        code: "invalid_metadata",
        message: "metadata must be an object.",
      })
    }

    let rails
    try {
      rails = normalizeCheckoutSessionRails(body.rails)
    } catch (error) {
      throw new V1ApiError({
        status: 400,
        type: "invalid_request_error",
        code: "invalid_rails",
        message: error instanceof Error ? error.message : "rails is invalid.",
      })
    }

    const normalizedBody = {
      amount,
      currency: optionalString(body.currency)?.toUpperCase() || "USD",
      reference: optionalString(body.reference),
      customer: { email: optionalString(body.customer?.email) },
      successUrl: optionalString(body.successUrl),
      cancelUrl: optionalString(body.cancelUrl),
      metadata: (body.metadata || {}) as Record<string, unknown>,
    }

    const metadata = {
      ...normalizedBody.metadata,
      ...(rails ? { [CHECKOUT_SESSION_RAILS_METADATA_KEY]: rails } : {}),
    }

    const created = await createCheckoutSessionEngine({
      merchantId,
      amount,
      currency: normalizedBody.currency,
      orderId: normalizedBody.reference,
      customerEmail: normalizedBody.customer.email,
      successUrl: normalizedBody.successUrl,
      cancelUrl: normalizedBody.cancelUrl,
      metadata,
      emitLegacyWebhook: false,
    })

    const session = await getPublicCheckoutSession(merchantId, created.sessionId)
    if (!session) {
      throw new Error("Created checkout session could not be loaded")
    }

    void deliverV1CheckoutSessionWebhook(
      merchantId,
      "checkout.session.created",
      session
    ).catch((error) => {
      console.error("[webhook] browser checkout.session.created delivery failed:", error)
    })

    return NextResponse.json(session, {
      status: 201,
      headers: { "X-Request-Id": requestId },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.startsWith("successUrl") || message.startsWith("cancelUrl")) {
      return v1ErrorResponse(
        new V1ApiError({
          status: 400,
          type: "invalid_request_error",
          code: "invalid_url",
          message,
        }),
        requestId
      )
    }
    return v1ErrorResponse(error, requestId)
  }
}
