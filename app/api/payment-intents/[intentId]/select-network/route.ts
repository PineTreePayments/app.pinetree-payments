import { NextRequest, NextResponse } from "next/server"
import { selectPaymentIntentNetworkEngine } from "@/engine/paymentIntents"
import { verifyCheckoutSession } from "@/lib/api/checkoutAuth"

type Params = { params: Promise<{ intentId: string }> }

function classifySelectNetworkError(message: string) {
  const normalized = message.toLowerCase()

  if (normalized.includes("timed out")) {
    return { status: 504, code: "PAYMENT_DETAILS_TIMEOUT" }
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
  try {
    const { intentId } = await params

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
    const asset = body?.asset ? String(body.asset).trim().toUpperCase() : undefined

    if (!network) {
      return NextResponse.json({ error: "Missing network selection" }, { status: 400 })
    }

    isBase = network === "base"
    if (isBase) {
      console.info("[PineTreeBaseTrace] select-network called", {
        step: "route-entry",
        intentId,
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
      network: result.network || result.selectedNetwork,
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to select payment network"
    const { status, code } = classifySelectNetworkError(message)

    if (isBase) {
      console.error("[PineTreeBaseTrace] select-network error", {
        step: "route-error",
        network: "base",
        error: message,
        code
      })
    }

    return NextResponse.json({ error: message, code }, { status })
  }
}
