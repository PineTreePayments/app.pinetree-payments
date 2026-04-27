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

  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split

  try {
    return await watchPaymentOnce({
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
      txHash: options?.txHash
    })
  } catch (error) {
    console.error("[checkPaymentOnce] watcher error", {
      paymentId,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}
