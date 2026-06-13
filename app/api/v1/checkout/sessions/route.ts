import { NextRequest, NextResponse } from "next/server"
import { createCheckoutSessionEngine } from "@/engine/checkoutSessions"
import {
  CHECKOUT_SESSION_RAILS_METADATA_KEY,
  normalizeCheckoutSessionRails,
} from "@/engine/checkoutSessionMetadata"
import {
  buildCheckoutSessionIdempotency,
  claimCheckoutSessionIdempotency,
  completeCheckoutSessionIdempotency,
  releaseCheckoutSessionIdempotency,
} from "@/engine/checkoutSessionIdempotency"
import { getPublicCheckoutSession } from "@/engine/publicCheckoutSessions"
import { listPublicCheckoutSessions } from "@/engine/publicCheckoutSessions"
import { requireV1MerchantApiKey } from "@/lib/api/v1/auth"
import { parseCheckoutSessionListQuery } from "@/lib/api/v1/checkoutSessionList"
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

export async function GET(req: NextRequest) {
  const requestId = getV1RequestId(req)
  try {
    const { merchantId } = await requireV1MerchantApiKey(req, "checkout.sessions:read")
    const filters = parseCheckoutSessionListQuery(req.url)
    const result = await listPublicCheckoutSessions({ merchantId, ...filters })
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

export async function POST(req: NextRequest) {
  const requestId = getV1RequestId(req)
  let claimedIdempotencyId: string | null = null
  let idempotentResourceCreated = false

  try {
    const { merchantId } = await requireV1MerchantApiKey(req, "checkout.sessions:create")

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
      rails,
    }
    const idempotencyKey = req.headers.get("idempotency-key")?.trim()
    const idempotency = idempotencyKey
      ? await buildCheckoutSessionIdempotency({
          key: idempotencyKey,
          body: normalizedBody,
        })
      : null

    if (idempotency) {
      const claim = await claimCheckoutSessionIdempotency({
        merchantId,
        keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash,
      })
      if (claim.state === "conflict") {
        throw new V1ApiError({
          status: 409,
          type: "idempotency_error",
          code: "idempotency_key_conflict",
          message: "The Idempotency-Key was already used with a different request body.",
        })
      }
      if (claim.state === "pending") {
        throw new V1ApiError({
          status: 409,
          type: "idempotency_error",
          code: "idempotency_request_in_progress",
          message: "A request with this Idempotency-Key is still in progress.",
        })
      }
      if (claim.state === "replay") {
        return NextResponse.json(claim.response, {
          status: 200,
          headers: {
            "X-Request-Id": requestId,
            "Idempotent-Replayed": "true",
          },
        })
      }
      claimedIdempotencyId = claim.claimId
    }

    const metadata = {
      ...((body.metadata || {}) as Record<string, unknown>),
      ...(rails ? { [CHECKOUT_SESSION_RAILS_METADATA_KEY]: rails } : {}),
    }

    // Phase 1 intentionally wraps the existing checkout-session engine. That
    // engine persists sessions as 24-hour checkout_links rows used by hosted checkout.
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
    idempotentResourceCreated = Boolean(claimedIdempotencyId)
    if (claimedIdempotencyId) {
      await completeCheckoutSessionIdempotency(claimedIdempotencyId, session)
      claimedIdempotencyId = null
    }
    void deliverV1CheckoutSessionWebhook(
      merchantId,
      "checkout.session.created",
      session
    ).catch((error) => {
      console.error("[webhook] v1 checkout.session.created delivery failed:", error)
    })

    return NextResponse.json(session, {
      status: 201,
      headers: { "X-Request-Id": requestId },
    })
  } catch (error) {
    if (claimedIdempotencyId && !idempotentResourceCreated) {
      try {
        await releaseCheckoutSessionIdempotency(claimedIdempotencyId)
      } catch {
        return v1ErrorResponse(
          new V1ApiError({
            status: 500,
            type: "api_error",
            code: "idempotency_storage_failure",
            message: "The idempotency claim could not be safely released.",
          }),
          requestId
        )
      }
    }
    if (error instanceof V1ApiError) return v1ErrorResponse(error, requestId)
    if (error instanceof Error && error.message.includes("idempotency claim")) {
      return v1ErrorResponse(
        new V1ApiError({
          status: 500,
          type: "api_error",
          code: "idempotency_storage_failure",
          message: "The idempotency record could not be stored.",
        }),
        requestId
      )
    }

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
