import { NextRequest, NextResponse } from "next/server"
import { processOffRampProviderWebhook } from "@/engine/offRampOperations"
import { OffRampProviderError } from "@/providers/offramp/types"

function getSignature(req: NextRequest) {
  return req.headers.get("moonpay-signature-v2") ||
    req.headers.get("Moonpay-Signature-V2") ||
    req.headers.get("x-moonpay-signature-v2") ||
    req.headers.get("x-moonpay-signature") ||
    null
}

function getWebhookErrorStatus(error: unknown) {
  if (error instanceof OffRampProviderError) return error.status

  const message = error instanceof Error ? error.message : ""
  if (message === "Invalid MoonPay webhook signature.") return 401
  if (message.includes("Unexpected token") || message.includes("JSON")) return 400
  return 500
}

function getWebhookErrorMessage(error: unknown) {
  if (error instanceof OffRampProviderError && error.status === 503) {
    return error.message
  }

  const status = getWebhookErrorStatus(error)
  if (status === 401) return "Invalid MoonPay webhook signature."
  if (status === 400) return "Invalid MoonPay webhook payload."
  return "MoonPay webhook processing failed."
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const result = await processOffRampProviderWebhook({
      provider: "moonpay",
      rawBody,
      signature: getSignature(req)
    })

    return NextResponse.json({
      received: true,
      processed: result.processed,
      matchedSession: result.matchedSession,
      sessionId: result.sessionId,
      statusUpdate: result.statusUpdate || null,
      providerStatus: result.providerStatus || null,
      fundMovementEnabled: false
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getWebhookErrorMessage(error) },
      { status: getWebhookErrorStatus(error) }
    )
  }
}
