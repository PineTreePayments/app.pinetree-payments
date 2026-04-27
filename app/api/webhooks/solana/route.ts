/**
 * Alchemy Webhook — Solana
 *
 * Thin API route. All logic stays in the engine.
 *
 * Flow:
 *   Alchemy push → verify signature → match activity to active Solana payments by wallet address
 *     → if matched: processPaymentEvent("payment.confirmed") → engine → DB
 *
 * Setup (one-time):
 *   1. alchemy.com → Dashboard → your app → Notify → Create Webhook
 *   2. Type: Address Activity, Network: Solana Mainnet
 *   3. Address: CXqPwfvDJ5HYBEwBC9id9oGH9hsf4gShywBN3WzDL5Aw (PineTree Solana treasury)
 *   4. URL: https://app.pinetree-payments.com/api/webhooks/solana
 *   5. Copy Signing Key → Vercel env: ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA
 *      (or ALCHEMY_WEBHOOK_SIGNING_KEY as fallback)
 */

import { NextRequest, NextResponse } from "next/server"
import { createHmac } from "crypto"
import { processAlchemyWebhook } from "@/engine/alchemyWebhookProcessor"

// ─── Signature verification ───────────────────────────────────────────────────

function verifyAlchemySignature(
  signatureHeader: string | null,
  rawBody: string,
  signingKey: string | undefined
): boolean {
  if (!signingKey) {
    console.error("[webhook:solana] Missing signing key — rejecting request")
    return false
  }
  if (!signatureHeader) return false
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex")
  return signatureHeader === expected
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
      process.env.ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA ??
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

    const result = await processAlchemyWebhook({ network: "solana", activities })

    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    console.error("[webhook:solana] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
