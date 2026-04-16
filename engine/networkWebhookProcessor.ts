/**
 * Network Activity Webhook Processor
 *
 * Handles push notifications from blockchain infrastructure providers
 * (Helius for Solana, Alchemy for Base/EVM) when a transaction touches
 * a registered wallet address.
 *
 * These are "network-level" webhooks — they tell us a transaction occurred
 * on a wallet, not which PineTree payment it corresponds to. The engine
 * resolves the match by running a single watcher iteration for all active
 * payments on that network.
 *
 * Fan-out control: `getActivePaymentsByNetwork` queries the DB with a
 * (status, network) filter so we only check payments that actually belong
 * to the network that fired — no in-memory filtering of unrelated rows.
 *
 * Flow:
 *   Provider push → verify signature → processNetworkWebhook
 *     → getActivePaymentsByNetwork (DB, filtered)
 *       → queueSingleWatcherIteration × N (each with 8 s timeout)
 *         → watchPaymentOnce → DB update
 */

import { getActivePaymentsByNetwork } from "@/database/payments"
import { queueSingleWatcherIteration } from "./paymentStatusOrchestrator"
import { createHmac } from "crypto"

const WATCHER_TIMEOUT_MS = 8000

function withTimeout(fn: () => Promise<void>): Promise<void> {
  return Promise.race([
    fn(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("watcher_timeout")), WATCHER_TIMEOUT_MS)
    )
  ])
}

// ─── Signature verification ───────────────────────────────────────────────────

/**
 * Verify a Helius webhook request.
 * Helius sends a plain bearer token in the Authorization header.
 */
export function verifyHeliusWebhook(
  authHeader: string | null,
  configuredToken: string | undefined
): boolean {
  if (!configuredToken) return true   // open in dev / if token not configured
  return (authHeader || "") === configuredToken
}

/**
 * Verify an Alchemy webhook request.
 * Alchemy sends an HMAC-SHA256 signature in the x-alchemy-signature header.
 */
export function verifyAlchemyWebhook(
  signatureHeader: string | null,
  rawBody: string,
  signingKey: string | undefined
): boolean {
  if (!signingKey) return true        // open in dev / if key not configured
  if (!signatureHeader) return false
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex")
  return signatureHeader === expected
}

// ─── Core processor ───────────────────────────────────────────────────────────

/**
 * Run one watcher iteration for every active payment on the given network.
 *
 * DB query is pre-filtered by (status IN [CREATED,PENDING,PROCESSING], network = ?)
 * so only relevant payments are loaded — no cross-network fan-out.
 *
 * Each check is raced against WATCHER_TIMEOUT_MS so the function returns within
 * Vercel's serverless execution limit even under RPC latency.
 */
async function processNetworkWebhook(
  network: "solana" | "base"
): Promise<{ checked: number; succeeded: number; failed: number }> {
  const active = await getActivePaymentsByNetwork(network, 50)

  if (active.length === 0) {
    return { checked: 0, succeeded: 0, failed: 0 }
  }

  const results = await Promise.allSettled(
    active.map((payment) =>
      withTimeout(() => queueSingleWatcherIteration(payment, `webhook:${network}`))
    )
  )

  return {
    checked: active.length,
    succeeded: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length
  }
}

// ─── Public entry points ──────────────────────────────────────────────────────

/**
 * Entry point for Helius (Solana) webhook.
 * Called from /api/webhooks/solana — verify first, then process.
 */
export async function processHeliusWebhook(authHeader: string | null): Promise<{
  authorized: boolean
  checked?: number
  succeeded?: number
  failed?: number
}> {
  const authorized = verifyHeliusWebhook(authHeader, process.env.HELIUS_WEBHOOK_AUTH_TOKEN)
  if (!authorized) return { authorized: false }

  const result = await processNetworkWebhook("solana")
  return { authorized: true, ...result }
}

/**
 * Entry point for Alchemy (Base) webhook.
 * Called from /api/webhooks/base — verify first, then process.
 */
export async function processAlchemyWebhook(
  signatureHeader: string | null,
  rawBody: string
): Promise<{
  authorized: boolean
  checked?: number
  succeeded?: number
  failed?: number
}> {
  const authorized = verifyAlchemyWebhook(
    signatureHeader,
    rawBody,
    process.env.ALCHEMY_WEBHOOK_SIGNING_KEY
  )
  if (!authorized) return { authorized: false }

  const result = await processNetworkWebhook("base")
  return { authorized: true, ...result }
}
