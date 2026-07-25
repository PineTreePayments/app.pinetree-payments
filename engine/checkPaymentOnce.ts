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
import { watchPaymentOnce, WatchOnceInput, RpcTransportError } from "./paymentWatcher"
import { StoredPaymentSplitMetadata } from "@/types/payment"
import { markPaymentIncompleteIfAbandoned } from "./paymentStateActions"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { logConfirmationTrace } from "@/lib/payment/confirmationTrace"
import { getTransactionByPaymentId } from "@/database/transactions"

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
// Payments currently running the expensive, no-txHash chunked-eth_getLogs
// fallback path (see watcherPath below) via THIS process. Keyed by
// paymentId. A caller that supplies its OWN options.txHash always runs
// immediately and standalone — it is never delayed behind, and never
// registers itself in, this map — so the fast receipt-check path (the one
// customer-facing callers depend on) can never be slowed down by dedup.
// This only dedupes overlap within a single warm serverless instance; it
// is not a cross-instance lock (see engine/paymentMaintenance.ts's own
// lease for the same, documented limitation).
const inFlightLogScanWatchers = new Map<string, Promise<boolean>>()

// Throttles how often a *sequential* series of no-txHash chunked-log-scan
// calls for the same payment may actually start a new scan — see the usage
// site below (right where watcherPath is computed) for the full rationale.
// Process-local, same caveat as inFlightLogScanWatchers above.
const NO_HASH_EVM_SCAN_COOLDOWN_MS = 15_000
const lastNoHashEvmScanStartedAt = new Map<string, number>()

export function resetNoHashEvmScanCooldownForTests(): void {
  lastNoHashEvmScanStartedAt.clear()
}

export async function runPaymentWatcher(
  paymentId: string,
  options?: { txHash?: string; maxAttempts?: number; sessionAttemptId?: string }
): Promise<boolean> {
  if (!options?.txHash) {
    const existing = inFlightLogScanWatchers.get(paymentId)
    if (existing) {
      console.info("[watcher:evm] scan deduplicated", {
        paymentId,
        reason: "already_in_flight_same_process"
      })
      return existing
    }
    const runPromise = runPaymentWatcherInternal(paymentId, options)
    inFlightLogScanWatchers.set(paymentId, runPromise)
    runPromise.finally(() => {
      if (inFlightLogScanWatchers.get(paymentId) === runPromise) {
        inFlightLogScanWatchers.delete(paymentId)
      }
    })
    return runPromise
  }
  return runPaymentWatcherInternal(paymentId, options)
}

async function runPaymentWatcherInternal(
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
    console.info("[watcher:evm] scan stopped: payment already terminal", { paymentId, status })
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

  // The tx-hash fast path (a single eth_getTransactionReceipt call) must be
  // authoritative whenever a canonical hash exists — including when the
  // caller (e.g. the maintenance cron's routine PENDING/PROCESSING re-check,
  // engine/paymentMaintenance.ts's runWatcherWithTimeout -> runPaymentWatcher(paymentId)
  // with no options) never explicitly passes one. Without this lookup a
  // payment whose hash was already persisted by an earlier /detect call
  // would still fall through to the broad eth_getLogs fallback scan on every
  // subsequent routine check, which is both slower and (before the chunking
  // fix below) capable of exceeding Alchemy's free-tier eth_getLogs block
  // range limit outright.
  let effectiveTxHash = String(options?.txHash || "").trim() || undefined
  let txHashSource: "caller_supplied" | "stored_provider_transaction_id" | "none" =
    effectiveTxHash ? "caller_supplied" : "none"
  if (!effectiveTxHash) {
    try {
      const transaction = await getTransactionByPaymentId(paymentId)
      const storedTxHash = String(transaction?.provider_transaction_id || "").trim()
      if (storedTxHash) {
        effectiveTxHash = storedTxHash
        txHashSource = "stored_provider_transaction_id"
      }
    } catch (error) {
      console.warn("[checkPaymentOnce] failed to look up stored transaction reference", {
        paymentId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  const watcherPath = effectiveTxHash ? "txHash-fast-path" : "chunked-log-fallback"
  const isEvmNetwork = isBase || String(payment.network || "").toLowerCase() === "ethereum"

  // A generic status read (GET /api/payments/status, polled every few
  // seconds by the POS terminal, the customer checkout page, and the Base
  // mirror alike) must not re-trigger the expensive, no-txHash eth_getLogs
  // scan on every single tick. Once a payment has a stored txHash the check
  // above already routes it through the cheap receipt-based fast path, so
  // this only ever throttles the genuinely expensive chunked-log fallback —
  // never a caller with a real tx hash to check (engine/paymentDetect.ts's
  // customer-facing POST /detect always bypasses this, since it always has
  // one). This is additive to, not a replacement for, the same-process
  // in-flight dedup above and engine/paymentMaintenance.ts's own 429
  // cooldown — dedup collapses concurrent callers into one scan, this
  // throttles how often a *sequential* series of scans for the same payment
  // may start at all.
  if (watcherPath === "chunked-log-fallback" && isEvmNetwork) {
    const lastStarted = lastNoHashEvmScanStartedAt.get(paymentId)
    if (typeof lastStarted === "number" && Date.now() - lastStarted < NO_HASH_EVM_SCAN_COOLDOWN_MS) {
      console.info("[watcher:evm] scan skipped: no-hash scan cooldown active", {
        paymentId,
        cooldownRemainingMs: NO_HASH_EVM_SCAN_COOLDOWN_MS - (Date.now() - lastStarted)
      })
      return false
    }
    lastNoHashEvmScanStartedAt.set(paymentId, Date.now())
  }

  if (isBase) {
    console.info("[watcher:evm] scan started", { paymentId, watcherPath, txHashSource })
    console.info("[PineTreeBaseTrace] watcher engine started", {
      step: "watcher-entry",
      paymentId,
      network: payment.network,
      asset: split?.asset || null,
      baseUsdcStrategy: split?.baseUsdcStrategy || null,
      splitContract: split?.splitContract || null,
      feeCaptureMethod: split?.feeCaptureMethod || null,
      txHash: effectiveTxHash || null,
      txHashSource,
      watcherPath,
      paymentStatus: payment.status
    })
  }

  const watchInput = buildBaseWatchInput(payment, { txHash: effectiveTxHash })

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
    (network === "base" || network === "ethereum") && Boolean(effectiveTxHash)
  const maxAttempts = options?.maxAttempts ?? (isEvmWithTxHash ? 5 : 1)
  const retryDelayMs = 3_000

  logConfirmationTrace("watcher_started", {
    paymentId,
    sessionAttemptId: options?.sessionAttemptId,
    transactionHash: effectiveTxHash,
    payload: { network: payment.network, maxAttempts, watcherPath, txHashSource }
  })

  // Tracks the most recent failure so that, if every attempt fails, we can
  // tell a real RPC/transport failure (the check never actually happened)
  // apart from a clean "no match yet" — see RpcTransportError in
  // paymentWatcher.ts. Reset to null whenever an attempt completes cleanly
  // (even with detected: false), since that proves the RPC endpoint is
  // actually working at that moment.
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const detected = await watchPaymentOnce(watchInput)
      lastError = null
      if (detected) {
        if (isBase) {
          console.info("[PineTreeBaseTrace] watcher detected payment", {
            step: "watcher-detected",
            paymentId,
            txHash: effectiveTxHash || null,
            network: payment.network,
            attempt
          })
        }
        logConfirmationTrace("watcher_detected_transaction", {
          paymentId,
          sessionAttemptId: options?.sessionAttemptId,
          transactionHash: effectiveTxHash,
          payload: { attempt, watcherPath }
        })
        return true
      }
    } catch (error) {
      lastError = error
      console.error("[checkPaymentOnce] watcher error", {
        paymentId,
        attempt,
        isRpcTransportError: error instanceof RpcTransportError,
        error: error instanceof Error ? error.message : String(error)
      })
      if (isBase) {
        console.error("[PineTreeBaseTrace] watcher attempt error", {
          step: "watcher-attempt-error",
          paymentId,
          txHash: effectiveTxHash || null,
          watcherPath,
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
      txHash: effectiveTxHash || null,
      watcherPath,
      network: payment.network,
      attemptsUsed: maxAttempts,
      finalFailureWasRpcTransportError: lastError instanceof RpcTransportError
    })
  }

  // Every attempt failed with an RPC-level error — the transaction was
  // never actually checked, so this must not be treated as "abandoned" or
  // "not detected". Surface it as a real error (counted by callers such as
  // engine/paymentMaintenance.ts's watcherErrors) instead of silently
  // marking the payment incomplete for lack of evidence we never obtained.
  if (lastError instanceof RpcTransportError) {
    throw lastError
  }

  await markPaymentIncompleteIfAbandoned(payment.id)

  return false
}
