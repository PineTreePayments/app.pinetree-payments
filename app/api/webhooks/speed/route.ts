import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/engine/eventProcessor"
import { loadProviders } from "@/engine/loadProviders"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { extractSpeedWebhookAccountId, isSpeedConnectedAccountWebhookPayload } from "@/providers/lightning/speedClient"
import { getMerchantIdBySpeedAccountId } from "@/database/merchantLightningProfiles"
import { scheduleLightningSweepProcessing } from "@/lib/api/lightningSweepMaintenance"
import { normalizeSpeedWebhookForWallet } from "@/engine/wallet/speedWalletWebhookNormalizer"

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
    // against the merchant's canonical server-side Speed account_id), never
    // on request headers or browser input. The signed payload then continues
    // through the existing canonical payment processor and the idempotent
    // wallet-operation normalizer below.
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

    // Additive wallet-activity normalization only - must never affect the
    // payment.created/payment.paid handling above, which already succeeded
    // by this point. Failures here are logged and swallowed.
    try {
      const result = await normalizeSpeedWebhookForWallet(payload, Object.fromEntries(req.headers))
      if (result.handled) {
        console.info("[webhooks/speed] wallet_activity_normalized", { reason: result.reason })
      }
    } catch (walletError) {
      console.error("[webhooks/speed] wallet_activity_normalization_failed", {
        error: walletError instanceof Error ? walletError.message : String(walletError),
      })
    }

    // Cheap and idempotent when there's nothing queued - never blocks this
    // response, and the lease inside scheduleLightningSweepProcessing
    // collapses overlapping ticks on a warm instance. The actual Speed
    // Instant Send call (once configured) never happens inside this request.
    scheduleLightningSweepProcessing("webhook:speed")

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
