/**
 * Helius Webhook Handler — Solana
 *
 * Helius (helius.dev) pushes a POST here whenever a transaction touches
 * any address registered in your Helius webhook. We register the PineTree
 * Solana treasury wallet so every atomic-split payment fires this endpoint.
 *
 * Flow (per .clinerules):
 *   Helius POST → verifyWebhook → get pending Solana payments → queueSingleWatcherIteration
 *
 * Setup instructions (one-time, no code changes needed):
 *   1. Create a free account at https://helius.dev
 *   2. Dashboard → Webhooks → Create Webhook
 *   3. Webhook URL: https://app.pinetree-payments.com/api/webhooks/solana
 *   4. Transaction types: TRANSFER (Enhanced)
 *   5. Account addresses: CXqPwfvDJ5HYBEwBC9id9oGH9hsf4gShywBN3WzDL5Aw (PineTree treasury)
 *   6. Copy the Auth Header value Helius generates
 *   7. Add to Vercel env vars: HELIUS_WEBHOOK_AUTH_TOKEN=<copied value>
 *
 * Also add your Helius RPC URL to get better rate limits:
 *   SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<your-api-key>
 */

import { NextRequest, NextResponse } from "next/server"
import { getPaymentsByStatus } from "@/database/payments"
import { queueSingleWatcherIteration } from "@/engine/paymentStatusOrchestrator"

function isAuthorized(req: NextRequest): boolean {
  const token = process.env.HELIUS_WEBHOOK_AUTH_TOKEN
  if (!token) return true  // open if not configured (dev)
  const auth = req.headers.get("authorization") || ""
  return auth === token
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
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Get all pending/processing Solana payments — only run watcher when a real
    // transaction arrives (Helius push), never on idle polling.
    const [pending, processing, created] = await Promise.all([
      getPaymentsByStatus("PENDING", 50),
      getPaymentsByStatus("PROCESSING", 50),
      getPaymentsByStatus("CREATED", 50)
    ])

    const solanaPending = [...pending, ...processing, ...created].filter(
      (p) => String(p.network || "").toLowerCase() === "solana"
    )

    if (solanaPending.length === 0) {
      return NextResponse.json({ received: true, checked: 0 })
    }

    const results = await Promise.allSettled(
      solanaPending.map((payment) =>
        withTimeout(() => queueSingleWatcherIteration(payment, "webhook:solana:helius"))
      )
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    return NextResponse.json({ received: true, checked: solanaPending.length, succeeded, failed })
  } catch (err) {
    console.error("[webhook:solana] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
