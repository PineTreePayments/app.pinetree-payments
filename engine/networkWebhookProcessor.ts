/**
 * Network Activity Webhook Processor
 *
 * Handles push notifications from blockchain infrastructure providers
 * (Helius for Solana, Alchemy for Base/EVM) that fire when a transaction
 * touches a registered wallet address.
 *
 * These are "network-level" webhooks — they tell us a transaction occurred on
 * a wallet, not which PineTree payment it corresponds to. The engine resolves
 * the match by running a single watcher iteration on all active payments for
 * that network.
 *
 * Per .clinerules webhook flow:
 *   Provider push → verifyWebhook() → engine (here) → queueSingleWatcherIteration → DB update
 *
 * Business logic lives here. API routes are thin wrappers that call these functions.
 */

import { getPaymentsByStatus } from "@/database/payments"
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

/**
 * Core processor — runs after auth is verified.
 * Fetches all active payments for the given network and runs one watcher
 * iteration per payment. The watcher checks the blockchain and confirms/fails
 * the payment if a matching transaction is found.
 *
 * CPU only consumed when a real blockchain transaction fires the webhook —
 * never on idle.
 */
async function processNetworkWebhook(network: "solana" | "base") {
  const [created, pending, processing] = await Promise.all([
    getPaymentsByStatus("CREATED", 50),
    getPaymentsByStatus("PENDING", 50),
    getPaymentsByStatus("PROCESSING", 50)
  ])

  const active = [...created, ...pending, ...processing].filter(
    (p) => String(p.network || "").toLowerCase() === network
  )

  if (active.length === 0) {
    return { checked: 0, succeeded: 0, failed: 0 }
  }

  const results = await Promise.allSettled(
    active.map((payment) =>
      withTimeout(() =>
        queueSingleWatcherIteration(payment, `webhook:${network}`)
      )
    )
  )

  return {
    checked: active.length,
    succeeded: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length
  }
}

/**
 * Entry point for Helius (Solana) webhook.
 * Call from /api/webhooks/solana — verify first, then process.
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
 * Call from /api/webhooks/base — verify first, then process.
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
