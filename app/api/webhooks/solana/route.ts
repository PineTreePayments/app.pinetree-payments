/**
 * Helius Webhook — Solana (thin API wrapper)
 *
 * All logic lives in engine/networkWebhookProcessor.ts per .clinerules.
 *
 * Setup (one-time):
 *   1. Sign up free at https://helius.dev
 *   2. Dashboard → Webhooks → Create Webhook
 *      - URL: https://app.pinetree-payments.com/api/webhooks/solana
 *      - Transaction types: TRANSFER (Enhanced)
 *      - Account address: CXqPwfvDJ5HYBEwBC9id9oGH9hsf4gShywBN3WzDL5Aw  (PineTree Solana treasury)
 *   3. Copy the Auth Header value Helius shows after creation
 *   4. Vercel → Settings → Env Vars → add:
 *        HELIUS_WEBHOOK_AUTH_TOKEN = <copied value>
 *   5. Optional — replace SOLANA_RPC_URL with your Helius RPC endpoint for better rate limits
 */

import { NextRequest, NextResponse } from "next/server"
import { processHeliusWebhook } from "@/engine/networkWebhookProcessor"

export async function POST(req: NextRequest) {
  try {
    const result = await processHeliusWebhook(req.headers.get("authorization"))

    if (!result.authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    console.error("[webhook:solana] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
