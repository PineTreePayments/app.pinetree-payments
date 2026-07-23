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
import type { Payment } from "@/database/payments"
import { watchPaymentOnce, WatchOnceInput } from "./paymentWatcher"
import { StoredPaymentSplitMetadata } from "@/types/payment"
import { markPaymentIncompleteIfAbandoned } from "./paymentStateActions"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { logConfirmationTrace } from "@/lib/payment/confirmationTrace"

/**
 * Build the WatchOnceInput for a payment from its stored split metadata.
 *
 * Single source of truth for the payment → watcher-input mapping so the
 * normal watcher path (below) and reconciliation/self-healing callers
 * (engine/baseChainReconciliation.ts) can never drift apart.
 */
export function buildBaseWatchInput(
  payment: Pick<Payment, "id" | "network" | "merchant_amount" | "pinetree_fee" | "metadata">,
  options?: { txHash?: string }
): WatchOnceInput {
  const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split

  return {
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
}

/**
 * Load a payment by ID and run a single blockchain check via watchPaymentOnce.
 *
 * Returns true if a matching on-chain transaction was found, false otherwise.
 * Never throws — all errors are caught and logged so callers can fire-and-forget.
 */
export async function runPaymentWatcher(
  paymentId: string,
  options?: { txHash?: string; maxAttempts?: number; sessionAttemptId?: string }
): Promise<boolean> {
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

  // Speed Lightning is never checked via an EVM/Solana RPC scan. Its signed
  // webhook and the authenticated customer-facing Lightning check route both
  // reconcile it while a checkout session is active; this call site covers
  // an explicit on-demand recheck (e.g. a merchant viewing a stuck payment)
  // once no checkout session is polling it anymore, via the same shared
  // reconciliation helper.
  if (String(payment.network || "").trim().toLowerCase() === "bitcoin_lightning") {
    if (String(payment.provider || "").toLowerCase() === SPEED_PROVIDER_NAME) {
      const { reconcileSpeedLightningPayment } = await import("./lightningSpeedReconciliation")
      try {
        const result = await reconcileSpeedLightningPayment(payment)
        return result.detected
      } catch (error) {
        console.error("[checkPaymentOnce] speed lightning reconciliation failed", {
          paymentId,
          error: error instanceof Error ? error.message : String(error)
        })
        return false
      }
    }
    return false
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

  const watchInput = buildBaseWatchInput(payment, { txHash: options?.txHash })

  // For EVM payments where we have a txHash, the receipt may not be available
  // immediately after the tx is submitted. Retry up to 5 times with a short delay
  // so detection succeeds without waiting for the next cron cycle.
  //
  // This internal retry loop sleeps synchronously (setTimeout) between
  // attempts. It is safe for background/cron callers (app/api/cron/*,
  // fire-and-forget calls) but must NEVER run at its default width inside a
  // customer-facing request — a caller blocked on this response (e.g. the
  // checkout page's POST /detect right after the wallet returns a hash) would
  // otherwise wait up to ~5 x 3s of pure sleep plus RPC latency, with no
  // timeout guard, before getting a response. Customer-facing callers pass
  // maxAttempts: 1 (see engine/paymentMaintenance.ts's ensurePaymentFresh) so
  // a single request performs one bounded check and returns immediately;
  // their own external retry loop (already polling every few seconds) is the
  // sole retry mechanism in that path.
  const network = payment.network ?? ""
  const isEvmWithTxHash =
    (network === "base" || network === "ethereum") && Boolean(options?.txHash)
  const maxAttempts = options?.maxAttempts ?? (isEvmWithTxHash ? 5 : 1)
  const retryDelayMs = 3_000

  logConfirmationTrace("watcher_started", {
    paymentId,
    sessionAttemptId: options?.sessionAttemptId,
    transactionHash: options?.txHash,
    payload: { network: payment.network, maxAttempts }
  })

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
        logConfirmationTrace("watcher_detected_transaction", {
          paymentId,
          sessionAttemptId: options?.sessionAttemptId,
          transactionHash: options?.txHash,
          payload: { attempt }
        })
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

  await markPaymentIncompleteIfAbandoned(payment.id)

  return false
}
