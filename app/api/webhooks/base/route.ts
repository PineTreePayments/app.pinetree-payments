/**
 * Alchemy Webhook — Base/EVM
 *
 * Thin API route. All logic stays in the engine.
 *
 * Flow:
 *   Alchemy push → verify signature → match activity to active payments by wallet address
 *     → direct (non-contract_split) payments: processPaymentEvent("payment.confirmed") → engine → DB
 *     → contract_split payments: address match alone cannot confirm — the txHash is
 *       handed to the same authoritative receipt/PaymentSplit verification pipeline
 *       the customer-facing POST /detect route uses (engine/alchemyWebhookProcessor.ts)
 *
 * Setup (one-time):
 *   1. Sign up free at https://alchemy.com
 *   2. Create an app → Network: Base Mainnet
 *   3. Dashboard → Notify → Create Webhook → Address Activity
 *      - URL: https://app.pinetree-payments.com/api/webhooks/base
 *      - Address: 0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903  (PineTree EVM treasury)
 *   4. Copy the Signing Key from the webhook details page
 *   5. Vercel → Settings → Env Vars → add:
 *        ALCHEMY_WEBHOOK_SIGNING_KEY_BASE = <copied value>
 *        (or ALCHEMY_WEBHOOK_SIGNING_KEY as fallback)
 */

import { NextRequest, NextResponse } from "next/server"
import { createHmac } from "crypto"
import { processAlchemyWebhook } from "@/engine/alchemyWebhookProcessor"
import { verifyHexHmac } from "@/lib/webhooks/verifyHexHmac"

// ─── Signature verification ───────────────────────────────────────────────────

function verifyAlchemySignature(
  signatureHeader: string | null,
  rawBody: string,
  signingKey: string | undefined
): boolean {
  if (!signingKey) {
    console.error("[webhook:base] Missing signing key — rejecting request")
    return false
  }
  if (!signatureHeader) return false
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex")
  // Constant-time comparison. This was `signatureHeader === expected`, which
  // short-circuits on the first differing character and leaks how much of a
  // guessed signature is correct. The HMAC construction above is unchanged:
  // same signing key, same raw body, same SHA-256, same lowercase hex digest.
  return verifyHexHmac(expected, signatureHeader)
}

// ─── Payload types ────────────────────────────────────────────────────────────

type AlchemyPayload = {
  event?: {
    activity?: unknown[]
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const signature = req.headers.get("x-alchemy-signature")
    const signingKey =
      process.env.ALCHEMY_WEBHOOK_SIGNING_KEY_BASE ??
      process.env.ALCHEMY_WEBHOOK_SIGNING_KEY

    if (!verifyAlchemySignature(signature, rawBody, signingKey)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = JSON.parse(rawBody) as AlchemyPayload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activities = (body?.event?.activity ?? []) as any[]

    if (activities.length === 0) {
      return NextResponse.json({ received: true, checked: 0, matched: 0 })
    }

    const result = await processAlchemyWebhook({ network: "base", activities })

    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    console.error("[webhook:base] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
