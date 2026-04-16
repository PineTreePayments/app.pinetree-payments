/**
 * Alchemy Webhook — Base/EVM (thin API wrapper)
 *
 * All logic lives in engine/networkWebhookProcessor.ts per .clinerules.
 *
 * Setup (one-time):
 *   1. Sign up free at https://alchemy.com
 *   2. Create an app → Network: Base Mainnet
 *   3. Dashboard → Notify → Create Webhook → Address Activity
 *      - URL: https://app.pinetree-payments.com/api/webhooks/base
 *      - Address: 0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903  (PineTree EVM treasury)
 *   4. Copy the Signing Key from the webhook details page
 *   5. Vercel → Settings → Env Vars → add:
 *        ALCHEMY_WEBHOOK_SIGNING_KEY = <copied value>
 *   6. Optional — replace BASE_RPC_URL with your Alchemy endpoint for better rate limits
 */

import { NextRequest, NextResponse } from "next/server"
import { processAlchemyWebhook } from "@/engine/networkWebhookProcessor"

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const result = await processAlchemyWebhook(
      req.headers.get("x-alchemy-signature"),
      rawBody
    )

    if (!result.authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    console.error("[webhook:base] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
