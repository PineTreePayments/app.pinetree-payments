/**
 * Alchemy Webhook — Solana (thin API wrapper)
 *
 * All logic lives in engine/networkWebhookProcessor.ts per .clinerules.
 *
 * Setup (one-time):
 *   1. alchemy.com → Dashboard → your app → Notify → Create Webhook
 *   2. Type: Address Activity, Network: Solana Mainnet
 *   3. Address: CXqPwfvDJ5HYBEwBC9id9oGH9hsf4gShywBN3WzDL5Aw (PineTree Solana treasury)
 *   4. URL: https://app.pinetree-payments.com/api/webhooks/solana
 *   5. Copy Signing Key → Vercel env: ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA
 */

import { NextRequest, NextResponse } from "next/server"
import { processAlchemySolanaWebhook } from "@/engine/networkWebhookProcessor"

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const result = await processAlchemySolanaWebhook(
      req.headers.get("x-alchemy-signature"),
      rawBody
    )

    if (!result.authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    console.error("[webhook:solana] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
