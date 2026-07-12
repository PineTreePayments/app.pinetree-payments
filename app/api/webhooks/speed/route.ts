import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/engine/eventProcessor"
import { loadProviders } from "@/engine/loadProviders"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { extractSpeedWebhookAccountId, isSpeedConnectedAccountWebhookPayload } from "@/providers/lightning/speedClient"
import { getMerchantIdBySpeedAccountId } from "@/database/merchantLightningProfiles"

export async function GET() {
  return NextResponse.json({ ok: true, provider: "speed", endpoint: "speed" })
}

export async function POST(req: NextRequest) {
  let rawBody = ""

  try {
    rawBody = await req.text()
    let payload: unknown

    try {
      payload = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      console.warn("[webhooks/speed] malformed JSON body rejected")
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 })
    }

    // Connected-account events route on the event's own account_id (matched
    // against the merchant's saved Speed account_id), never on request
    // headers or an assumed payload shape. Diagnostic/identification only for
    // now - not yet wired into settlement/fee logic, since exactly how Speed
    // structures a connected-account payment's body/metadata is still an open
    // provider-contract question (see PAYMENT CREATION GAP).
    if (isSpeedConnectedAccountWebhookPayload(payload)) {
      const accountId = extractSpeedWebhookAccountId(payload)
      const merchantId = accountId ? await getMerchantIdBySpeedAccountId(accountId) : null
      console.info("[webhooks/speed] connected_account_event_identified", {
        accountIdPresent: Boolean(accountId),
        merchantMatched: Boolean(merchantId),
      })
    }

    await loadProviders()
    await processWebhook({
      provider: SPEED_PROVIDER_NAME,
      payload,
      headers: Object.fromEntries(req.headers),
      rawBody
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook failed"

    if (message === "Webhook verification failed") {
      console.warn("[webhooks/speed] signature verification failed", {
        bodyLength: rawBody.length,
        hasSignatureHeader: Boolean(req.headers.get("webhook-signature")),
        hasTimestampHeader: Boolean(req.headers.get("webhook-timestamp")),
        hasWebhookIdHeader: Boolean(req.headers.get("webhook-id"))
      })
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 })
    }

    console.error("[webhooks/speed] non-critical processing error acknowledged", {
      error: message,
      bodyLength: rawBody.length
    })
    return NextResponse.json({ received: true, processed: false, provider: "speed" })
  }
}
