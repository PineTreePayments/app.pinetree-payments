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
import { getActivePaymentsByNetwork } from "@/database/payments"
import { processPaymentEvent } from "@/engine/eventProcessor"

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

type SolanaTransfer = {
  fromUserAccount?: string
  toUserAccount?: string
  amount?: number
}

type SolanaActivity = {
  signature?: string
  nativeTransfers?: SolanaTransfer[]
  tokenTransfers?: SolanaTransfer[]
}

type AlchemyPayload = {
  event?: {
    activity?: SolanaActivity[]
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
      process.env.ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA ??
      process.env.ALCHEMY_WEBHOOK_SIGNING_KEY

    if (!verifyAlchemySignature(signature, rawBody, signingKey)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = JSON.parse(rawBody) as AlchemyPayload
    const activities = body?.event?.activity ?? []

    if (activities.length === 0) {
      return NextResponse.json({ received: true, checked: 0, matched: 0 })
    }

    const active = await getActivePaymentsByNetwork("solana", 50)

    // Build wallet address → payment map for O(1) lookup per transfer entry.
    const walletToPayment = new Map<string, (typeof active)[0]>()
    for (const payment of active) {
      const split = ((payment.metadata ?? null) as SplitMetadata | null)?.split
      if (split?.merchantWallet) {
        walletToPayment.set(split.merchantWallet, payment)
      }
      if (split?.pinetreeWallet) {
        walletToPayment.set(split.pinetreeWallet, payment)
      }
    }

    const results = await Promise.allSettled(
      activities.flatMap((activity) => {
        const txHash = activity.signature
        const transfers = [
          ...(activity.nativeTransfers ?? []),
          ...(activity.tokenTransfers ?? [])
        ]

        return transfers.map(async (transfer) => {
          const toAccount = transfer.toUserAccount
          if (!toAccount) return

          const payment = walletToPayment.get(toAccount)
          if (!payment) return

          await processPaymentEvent({
            type: "payment.confirmed",
            paymentId: payment.id,
            txHash,
            value: transfer.amount !== undefined ? String(transfer.amount) : undefined,
            from: transfer.fromUserAccount,
            feeCaptureValidated: false
          })
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
    console.error("[webhook:solana] error", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
