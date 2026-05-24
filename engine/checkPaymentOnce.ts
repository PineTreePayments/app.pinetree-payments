/**
 * PineTree — runPaymentWatcher
 *
 * Thin orchestration layer that loads a payment from the database and hands it
 * off to watchPaymentOnce for a single bounded blockchain check.
 *
 * Referenced in paymentWatcher.ts header as the intended caller.
 * Called from:
 *   - app/api/payments/route.ts  → fire-and-forget on payment creation
 *   - app/api/cron/check-payments/route.ts  → periodic sweep (can migrate here)
 */

import { getPaymentById } from "@/database"
import { watchPaymentOnce } from "./paymentWatcher"
import { StoredPaymentSplitMetadata } from "@/types/payment"

/**
 * Load a payment by ID and run a single blockchain check via watchPaymentOnce.
 *
 * Returns true if a matching on-chain transaction was found, false otherwise.
 * Never throws — all errors are caught and logged so callers can fire-and-forget.
 */
export async function runPaymentWatcher(paymentId: string, options?: { txHash?: string }): Promise<boolean> {
  let payment: Awaited<ReturnType<typeof getPaymentById>>

  try {
    payment = await getPaymentById(paymentId)
  } catch (error) {
    console.error("[checkPaymentOnce] failed to load payment", {
      paymentId,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }

  if (!payment) {
    console.warn("[checkPaymentOnce] payment not found", { paymentId })
    return false
  }

  // Nothing left to do for terminal states.
  const status = String(payment.status || "").toUpperCase()
  if (status === "CONFIRMED" || status === "FAILED" || status === "INCOMPLETE") {
    return false
  }

  // NWC Lightning: invoice status is checked via the NWC protocol, not by blockchain scanning.
  // Short-circuit here so watchPaymentOnce (which only knows Solana/EVM) is never called.
  if (
    String(payment.network || "").toLowerCase() === "bitcoin_lightning" &&
    String(payment.provider || "").toLowerCase() === "lightning_nwc"
  ) {
    const { checkNwcPaymentOnce } = await import("./checkNwcPayment")
    return checkNwcPaymentOnce(payment.id)
  }

  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
  const isBase = String(payment.network || "").toLowerCase() === "base"

  if (isBase) {
    console.info("[PineTreeBaseTrace] watcher engine started", {
      step: "watcher-entry",
      paymentId,
      network: payment.network,
      asset: split?.asset || null,
      baseUsdcStrategy: split?.baseUsdcStrategy || null,
      splitContract: split?.splitContract || null,
      feeCaptureMethod: split?.feeCaptureMethod || null,
      txHash: options?.txHash || null,
      paymentStatus: payment.status
    })
  }

  const watchInput = {
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
    splitContract: split?.splitContract,
    asset: split?.asset,
    txHash: options?.txHash
  }

  // For EVM payments where we have a txHash, the receipt may not be available
  // immediately after the tx is submitted. Retry up to 5 times with a short delay
  // so detection succeeds without waiting for the next cron cycle.
  const network = payment.network ?? ""
  const isEvmWithTxHash =
    (network === "base" || network === "ethereum") && Boolean(options?.txHash)
  const maxAttempts = isEvmWithTxHash ? 5 : 1
  const retryDelayMs = 3_000

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const detected = await watchPaymentOnce(watchInput)
      if (detected) {
        if (isBase) {
          console.info("[PineTreeBaseTrace] watcher detected payment", {
            step: "watcher-detected",
            paymentId,
            txHash: options?.txHash || null,
            network: payment.network,
            attempt
          })
        }
        return true
      }
    } catch (error) {
      console.error("[checkPaymentOnce] watcher error", {
        paymentId,
        attempt,
        error: error instanceof Error ? error.message : String(error)
      })
      if (isBase) {
        console.error("[PineTreeBaseTrace] watcher attempt error", {
          step: "watcher-attempt-error",
          paymentId,
          txHash: options?.txHash || null,
          network: payment.network,
          attempt,
          maxAttempts,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }

  if (isBase) {
    console.info("[PineTreeBaseTrace] watcher completed without detection", {
      step: "watcher-not-detected",
      paymentId,
      txHash: options?.txHash || null,
      network: payment.network,
      attemptsUsed: maxAttempts
    })
  }

  return false
}
