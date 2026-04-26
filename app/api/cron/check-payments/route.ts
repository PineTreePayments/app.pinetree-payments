import { NextRequest, NextResponse } from "next/server"
import { getPaymentsByStatus } from "@/database"
import { watchPaymentOnce } from "@/engine/paymentWatcher"

// Vercel cron secret — set CRON_SECRET in your Vercel env vars to secure this endpoint
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron:check-payments] Missing CRON_SECRET — rejecting request")
    return false
  }
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

type SplitMeta = {
  merchantWallet?: string
  pinetreeWallet?: string
  expectedAmountNative?: number
  // createPayment stores these names — keep both for backwards compatibility
  merchantNativeAmountAtomic?: string | number
  feeNativeAmountAtomic?: string | number
  expectedMerchantAtomic?: string | number
  expectedFeeAtomic?: string | number
  feeCaptureMethod?: string
  splitContract?: string
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Check CREATED, PENDING, and PROCESSING payments — all are watchable states
    const [created, pending, processing] = await Promise.all([
      getPaymentsByStatus("CREATED", 50),
      getPaymentsByStatus("PENDING", 50),
      getPaymentsByStatus("PROCESSING", 50)
    ])

    const watchable = [...created, ...pending, ...processing]

    if (watchable.length === 0) {
      return NextResponse.json({ checked: 0 })
    }

    // Run watcher iterations in parallel — each does a single blockchain check.
    // Each check is raced against an 8s timeout so the function always returns
    // within Vercel's free-tier 10s limit regardless of RPC latency.
    const runWatcher = (payment: typeof watchable[number]) => {
      const split = ((payment.metadata ?? null) as { split?: SplitMeta } | null)?.split
      return Promise.race([
        watchPaymentOnce({
          paymentId: payment.id,
          network: payment.network ?? "",
          merchantWallet: split?.merchantWallet ?? "",
          pinetreeWallet: split?.pinetreeWallet ?? "",
          merchantAmount: Number(payment.merchant_amount ?? 0),
          pinetreeFee: Number(payment.pinetree_fee ?? 0),
          expectedAmountNative: split?.expectedAmountNative,
          // prefer the canonical field names written by createPayment; fall back to legacy aliases
          expectedMerchantAtomic: split?.merchantNativeAmountAtomic ?? split?.expectedMerchantAtomic,
          expectedFeeAtomic: split?.feeNativeAmountAtomic ?? split?.expectedFeeAtomic,
          feeCaptureMethod: split?.feeCaptureMethod,
          splitContract: split?.splitContract
        }),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("watcher_timeout")), 8000)
        )
      ])
    }

    const results = await Promise.allSettled(watchable.map(runWatcher))

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    return NextResponse.json({
      checked: watchable.length,
      succeeded,
      failed
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[cron:check-payments] fatal error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
