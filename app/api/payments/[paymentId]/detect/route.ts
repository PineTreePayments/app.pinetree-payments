import { NextRequest, NextResponse } from "next/server"
import { getPaymentById } from "@/database"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"
import type { StoredPaymentSplitMetadata } from "@/types/payment"
import {
  getTransactionByPaymentId,
  updateTransactionProviderReference
} from "@/database/transactions"

function isEvmTxHash(value?: string): value is string {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim())
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  let paymentId = ""
  let isBase = false
  try {
    const params = await context.params
    paymentId = String(params.paymentId || "").trim()

    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }

    const payment = await getPaymentById(paymentId)
    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    }

    const status = String(payment.status || "").toUpperCase()
    if (!["CREATED", "PENDING", "PROCESSING"].includes(status)) {
      return NextResponse.json({ detected: false, skipped: true })
    }

    let txHash: string | undefined
    try {
      const body = (await req.json()) as { txHash?: string }
      txHash = body.txHash
    } catch {
      // body is optional
    }

    isBase = String(payment.network || "").toLowerCase() === "base"

    if (isBase) {
      const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
      console.info("[PineTreeBaseTrace] detect called", {
        step: "detect-entry",
        paymentId,
        txHashPresent: Boolean(txHash),
        network: payment.network,
        asset: split?.asset || null,
        v7RouteUsed: true,
        baseUsdcStrategy: split?.baseUsdcStrategy || null,
        splitContract: split?.splitContract || null,
        paymentStatus: payment.status
      })

      if (txHash && !isEvmTxHash(txHash)) {
        console.warn("[PineTreeBaseTrace] detect invalid tx hash", {
          step: "detect-invalid-txhash",
          paymentId,
          txHashPresent: true
        })
        return NextResponse.json({ error: "Invalid Base transaction hash" }, { status: 400 })
      }

      if (txHash) {
        const transaction = await getTransactionByPaymentId(paymentId)
        if (transaction && !transaction.provider_transaction_id) {
          try {
            await updateTransactionProviderReference(transaction.id, txHash)
          } catch (error) {
            console.warn("[PineTreeBaseTrace] detect tx hash store failed", {
              step: "detect-store-txhash-failed",
              paymentId,
              txHashPresent: true,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }
    }

    console.info("[detect] triggered", { paymentId, txHash, network: payment.network })

    if (isBase) {
      console.info("[PineTreeBaseTrace] detect watcher start", {
        step: "detect-watcher-start",
        paymentId,
        txHash: txHash || null,
        network: payment.network
      })
    }

    const detected = await runPaymentWatcher(payment.id, { txHash })
    const updatedPayment = await getPaymentById(paymentId)

    if (isBase) {
      console.info("[PineTreeBaseTrace] detect watcher result", {
        step: "detect-watcher-done",
        paymentId,
        txHashPresent: Boolean(txHash),
        network: payment.network,
        detected,
        finalPaymentStatus: String(updatedPayment?.status || payment.status || "").toUpperCase()
      })
    }

    console.info("[detect] result", { paymentId, detected })

    return NextResponse.json({
      detected,
      status: String(updatedPayment?.status || payment.status || "").toUpperCase()
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Detection failed"
    console.error("[detect] error:", message)
    if (isBase) {
      console.error("[PineTreeBaseTrace] detect error", {
        step: "detect-error",
        paymentId,
        error: message
      })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
