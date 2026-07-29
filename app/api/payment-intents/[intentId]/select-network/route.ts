import { NextRequest, NextResponse } from "next/server"
import { selectPaymentIntentNetworkEngine } from "@/engine/paymentIntents"
import { verifyCheckoutSession } from "@/lib/api/checkoutAuth"
import {
  describeSpeedApiError,
  getSafeSpeedCustomerErrorMessage,
  isSpeedConnectedAccountMissingError,
  SpeedApiError,
  SpeedTransportError,
} from "@/providers/lightning/speedClient"
import { normalizePaymentCorrelationId, PAYMENT_CORRELATION_HEADER } from "@/lib/payment/paymentCorrelation"

type Params = { params: Promise<{ intentId: string }> }

function classifySelectNetworkError(message: string) {
  const normalized = message.toLowerCase()

  if (normalized.includes("timed out")) {
    return { status: 504, code: "PAYMENT_DETAILS_TIMEOUT" }
  }

  if (
    normalized.includes("payment attempt has ended") ||
    normalized.includes("payment already submitted") ||
    normalized.includes("cannot switch rails")
  ) {
    return { status: 409, code: "PAYMENT_NOT_RETRYABLE" }
  }

  if (
    normalized.includes("missing pinetree treasury wallet") ||
    normalized.includes("missing required environment variables") ||
    normalized.includes("invalid pinetree treasury wallet format")
  ) {
    return { status: 500, code: "TREASURY_CONFIG_ERROR" }
  }

  if (
    normalized.includes("payment intent not found") ||
    normalized.includes("unsupported") ||
    normalized.includes("not enabled") ||
    normalized.includes("no wallet configured for merchant") ||
    normalized.includes("no payment provider connected")
  ) {
    return { status: 400, code: "PAYMENT_SETUP_ERROR" }
  }

  return { status: 500, code: "SELECT_NETWORK_FAILED" }
}

export async function POST(req: NextRequest, { params }: Params) {
  let isBase = false
  let selectedNetwork = ""
  let correlationIntentId = ""
  let correlationId: string | undefined
  try {
    const { intentId } = await params
    correlationIntentId = String(intentId || "").trim()
    correlationId = normalizePaymentCorrelationId(req.headers.get(PAYMENT_CORRELATION_HEADER))

    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
    if (!token) {
      return NextResponse.json({ error: "Checkout session token required", code: "MISSING_CHECKOUT_TOKEN" }, { status: 401 })
    }
    let claims: ReturnType<typeof verifyCheckoutSession>
    try {
      claims = verifyCheckoutSession(token)
    } catch {
      return NextResponse.json({ error: "Invalid or expired checkout session", code: "INVALID_CHECKOUT_TOKEN" }, { status: 401 })
    }
    if (claims.iid !== intentId) {
      return NextResponse.json({ error: "Checkout session does not match this payment intent", code: "CHECKOUT_TOKEN_MISMATCH" }, { status: 403 })
    }

    const body = (await req.json()) as { network?: string; asset?: string }
    const network = String(body?.network || "").trim().toLowerCase()
    selectedNetwork = network
    const asset = body?.asset ? String(body.asset).trim().toUpperCase() : undefined

    if (!network) {
      return NextResponse.json({ error: "Missing network selection" }, { status: 400 })
    }

    isBase = network === "base"
    if (isBase) {
      console.info("[PineTreeBaseTrace] select-network called", {
        step: "route-entry",
        intentId,
        correlationId: correlationId || null,
        network,
        asset: asset || null
      })
    }

    const idempotencyKey = req.headers.get("idempotency-key") || undefined

    const result = await selectPaymentIntentNetworkEngine({
      intentId: String(intentId || "").trim(),
      network,
      asset,
      idempotencyKey
    })

    if (isBase) {
      const r = result as Record<string, unknown>
      const splitData = ((r.metadata as Record<string, unknown> | undefined)?.split as Record<string, unknown>) ?? {}
      const baseUsdcStrategy = splitData.baseUsdcStrategy || r.baseUsdcStrategy || null
      const splitContract = String(splitData.splitContract || "").trim() || null
      const paymentUrl = String(r.paymentUrl || "")
      console.info("[PineTreeBaseTrace] select-network success", {
        step: "route-response",
        intentId,
        paymentId: r.paymentId || null,
        network: r.network || r.selectedNetwork || network,
        asset: asset || null,
        baseUsdcStrategy,
        splitContract,
        paymentUrlKind: paymentUrl.startsWith("pinetree://base-v7")
          ? "pinetree://base-v7"
          : paymentUrl.startsWith("ethereum:")
            ? "ethereum:"
            : "other"
      })
    }

    console.info("[api/select-network] returning paymentUrl", {
      intentId,
      correlationId: correlationId || null,
      network: result.network,
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to select payment network"
    const { status, code } = error instanceof SpeedApiError
      ? {
          status: error.status >= 500 ? 503 : error.status,
          code: isSpeedConnectedAccountMissingError(error)
            ? "LIGHTNING_ACCOUNT_NOT_CONNECTED"
            : error.retryable
              ? "LIGHTNING_PROVIDER_TEMPORARY"
              : "LIGHTNING_PAYMENT_INVALID",
        }
      : error instanceof SpeedTransportError
        ? { status: 503, code: "LIGHTNING_PROVIDER_TEMPORARY" }
        : classifySelectNetworkError(message)
    const customerMessage = selectedNetwork === "bitcoin_lightning"
      ? getSafeSpeedCustomerErrorMessage(error) || (/timed out|timeout|network|unreachable/i.test(message)
          ? "We couldn't prepare the Bitcoin Lightning payment. Check your connection and try again."
          : "We couldn't create this Bitcoin Lightning payment. Please choose another payment method or try again.")
      : message

    if (isBase) {
      console.error("[PineTreeBaseTrace] select-network error", {
        step: "route-error",
        network: "base",
        error: message,
        code
      })
    }

    // Sanitized provider detail is attached to the primary failure log so a
    // provider rejection is diagnosable here, without correlating against a
    // separate provider_error_detail entry. describeSpeedApiError emits only
    // status, provider code/message, and request id — never request headers,
    // secret material, or the raw provider payload.
    console.error("[api/select-network] failed", {
      intentId: correlationIntentId || null,
      correlationId: correlationId || null,
      network: selectedNetwork || null,
      code,
      status,
      error: message,
      provider: describeSpeedApiError(error),
    })

    return NextResponse.json({ error: customerMessage, code }, { status })
  }
}
