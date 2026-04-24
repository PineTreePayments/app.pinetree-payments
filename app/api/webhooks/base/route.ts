/**
 * Alchemy Webhook — Base/EVM
 *
 * Thin API route. All logic stays in the engine.
 *
 * Flow:
 *   Alchemy push → verify signature → match activity to active payments by wallet address
 *     → if matched: processPaymentEvent("payment.confirmed") → engine → DB
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
import { getActivePaymentsByNetwork } from "@/database/payments"
import { processPaymentEvent } from "@/engine/eventProcessor"

// ─── Signature verification ───────────────────────────────────────────────────

function verifyAlchemySignature(
  signatureHeader: string | null,
  rawBody: string,
  signingKey: string | undefined
): boolean {
  if (!signingKey) return true
  if (!signatureHeader) return false
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex")
  return signatureHeader === expected
}

// ─── Payload types ────────────────────────────────────────────────────────────

type AlchemyActivity = {
  fromAddress?: string
  toAddress?: string
  hash?: string
  value?: number
  asset?: string
}

type AlchemyPayload = {
  event?: {
    activity?: AlchemyActivity[]
  }
}

type SplitMetadata = {
  split?: {
    merchantWallet?: string
    pinetreeWallet?: string
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
    const activities = body?.event?.activity ?? []

    if (activities.length === 0) {
      return NextResponse.json({ received: true, checked: 0, matched: 0 })
    }

    const active = await getActivePaymentsByNetwork("base", 50)

    // Build lowercase wallet address → payment map for O(1) lookup per activity entry.
    const walletToPayment = new Map<string, (typeof active)[0]>()
    for (const payment of active) {
      const split = ((payment.metadata ?? null) as SplitMetadata | null)?.split
      if (split?.merchantWallet) {
        walletToPayment.set(split.merchantWallet.toLowerCase(), payment)
      }
      if (split?.pinetreeWallet) {
        walletToPayment.set(split.pinetreeWallet.toLowerCase(), payment)
      }
    }

    const results = await Promise.allSettled(
      activities.map(async (activity) => {
        const toAddress = activity.toAddress?.toLowerCase()
        if (!toAddress) return

        const payment = walletToPayment.get(toAddress)
        if (!payment) return

        await processPaymentEvent({
          type: "payment.confirmed",
          paymentId: payment.id,
          txHash: activity.hash,
          value: activity.value !== undefined ? String(activity.value) : undefined,
          from: activity.fromAddress,
          feeCaptureValidated: false
        })
      })
    )

    return NextResponse.json({
      received: true,
      checked: activities.length,
      matched: results.filter((r) => r.status === "fulfilled").length,
      failed: results.filter((r) => r.status === "rejected").length
    })
  } catch (err) {
    console.error("[webhook:base] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
