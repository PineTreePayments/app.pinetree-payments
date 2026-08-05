import { NextRequest, NextResponse } from "next/server"

import { ingestBridgeWebhookEventEngine } from "@/engine/bridgeConnect"

/**
 * Bridge (by Stripe) webhook endpoint.
 *
 * Bridge signs the RAW request body, so this route reads `req.text()` and
 * hands those exact bytes, plus the raw headers, to PineTree Engine. Nothing
 * is parsed, resolved, or trusted here, and the route deliberately imports no
 * provider internals - the Engine owns verification and the header contract.
 *
 * Responses:
 *   200 - verified and durably ingested (including a duplicate redelivery,
 *         which is acknowledged rather than reprocessed)
 *   400 - invalid signature, stale timestamp, or malformed body; Bridge
 *         retries a genuine-but-stale delivery
 *   500 - PineTree failed to durably store a verified event, so Bridge must
 *         retry rather than have the event silently dropped
 */
export async function GET() {
  return NextResponse.json({ ok: true, provider: "bridge", endpoint: "bridge" })
}

export async function POST(req: NextRequest) {
  let rawBody = ""

  try {
    rawBody = await req.text()

    const result = await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: Object.fromEntries(req.headers),
    })

    if (!result.ok) {
      // The precise reason is logged inside the Engine. The response body
      // stays generic so a probe cannot learn why verification failed.
      return NextResponse.json(
        { error: result.status === 400 ? "Invalid webhook" : "Webhook processing failed" },
        { status: result.status }
      )
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("[webhooks/bridge] processing failed - returning 5xx for retry", {
      error: error instanceof Error ? error.message : String(error),
      bodyLength: rawBody.length,
    })
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
