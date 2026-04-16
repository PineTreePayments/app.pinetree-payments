/**
 * Alchemy Notify Webhook Handler — Base / EVM
 *
 * Alchemy (alchemy.com) pushes a POST here whenever a transaction touches
 * any address registered in your Alchemy notify webhook. Register the PineTree
 * EVM treasury wallet so every Base payment fires this endpoint.
 *
 * Flow (per .clinerules):
 *   Alchemy POST → verifyWebhook → get pending Base payments → queueSingleWatcherIteration
 *
 * Setup instructions (one-time, no code changes needed):
 *   1. Create a free account at https://alchemy.com
 *   2. Dashboard → Notify → Create Webhook → Address Activity
 *   3. Network: Base Mainnet
 *   4. Webhook URL: https://app.pinetree-payments.com/api/webhooks/base
 *   5. Addresses to watch: 0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903 (PineTree treasury)
 *   6. Copy the Signing Key from the webhook details page
 *   7. Add to Vercel env vars: ALCHEMY_WEBHOOK_SIGNING_KEY=<copied value>
 *
 * Also update your Base RPC URL to use Alchemy for better rate limits:
 *   BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<your-api-key>
 */

import { NextRequest, NextResponse } from "next/server"
import { createHmac } from "crypto"
import { getPaymentsByStatus } from "@/database/payments"
import { queueSingleWatcherIteration } from "@/engine/paymentStatusOrchestrator"

function isAuthorized(req: NextRequest, rawBody: string): boolean {
  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY
  if (!signingKey) return true  // open if not configured (dev)

  const signature = req.headers.get("x-alchemy-signature") || ""
  if (!signature) return false

  const hmac = createHmac("sha256", signingKey)
  hmac.update(rawBody)
  const expected = hmac.digest("hex")

  return signature === expected
}

const WATCHER_TIMEOUT_MS = 8000

function withTimeout(fn: () => Promise<void>): Promise<void> {
  return Promise.race([
    fn(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("watcher_timeout")), WATCHER_TIMEOUT_MS)
    )
  ])
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!isAuthorized(req, rawBody)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const [pending, processing, created] = await Promise.all([
      getPaymentsByStatus("PENDING", 50),
      getPaymentsByStatus("PROCESSING", 50),
      getPaymentsByStatus("CREATED", 50)
    ])

    const basePending = [...pending, ...processing, ...created].filter(
      (p) => String(p.network || "").toLowerCase() === "base"
    )

    if (basePending.length === 0) {
      return NextResponse.json({ received: true, checked: 0 })
    }

    const results = await Promise.allSettled(
      basePending.map((payment) =>
        withTimeout(() => queueSingleWatcherIteration(payment, "webhook:base:alchemy"))
      )
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    return NextResponse.json({ received: true, checked: basePending.length, succeeded, failed })
  } catch (err) {
    console.error("[webhook:base] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
