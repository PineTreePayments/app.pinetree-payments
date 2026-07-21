/**
 * Sweep job execution - rail-aware. Manual withdrawals, saved-address
 * withdrawals, and automatic sweeps all eventually call the same canonical
 * withdrawal dispatcher (engine/withdrawals/canonicalWithdrawal.ts); this
 * file's only job is deciding WHEN that call happens and recording the
 * result, never a separate provider integration.
 *
 * Bitcoin (Speed custodial sub-account) executes immediately, server-side,
 * with no browser required - genuinely unattended automation.
 *
 * Base/Solana (self-custodial Dynamic embedded wallet) CANNOT execute
 * unattended - there is no server-side/headless signing capability for
 * Dynamic anywhere in this repo (confirmed: providers/wallets/withdrawalSigner.ts's
 * dynamicBrowserWithdrawalSigner throws by design if called server-side).
 * The cron processor only re-confirms these jobs are still eligible and
 * releases them back to QUEUED (or AWAITING_GAS) - actual submission happens
 * client-side, the next time the merchant has an authenticated Wallet
 * session with the matching embedded wallet ready (see
 * app/dashboard/wallet-setup/page.tsx's useAutomaticSweepContinuation hook).
 */

import {
  getSweepJobForMerchant,
  updateSweepJob,
  insertSweepEvent,
  type WalletSweepJob,
  type SweepJobStatus,
} from "@/database/walletSweepJobs"
import { getSweepRule, markSweepRuleExecutionResult } from "@/database/walletSweepRules"
import { submitCanonicalWithdrawal } from "@/engine/withdrawals/canonicalWithdrawal"
import { estimateMaxWithdrawalAmount } from "@/engine/withdrawals/withdrawalFeeEstimate"

function getSweepMaxAttempts(): number {
  const configured = Number(process.env.WALLET_SWEEP_MAX_ATTEMPTS || "")
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 5
}

async function transitionJob(job: WalletSweepJob, toStatus: SweepJobStatus, reason: string | null): Promise<void> {
  await updateSweepJob(job.id, { status: toStatus, failureReason: reason })
  await insertSweepEvent({ jobId: job.id, fromStatus: job.status, toStatus, reason })
}

/**
 * Executes a single, already-claimed (status=PROCESSING) Bitcoin sweep job.
 * Idempotency key is stable and derived from the job id, so a retry (this
 * function called again for the same job after a crash, a stalled-job
 * reset, or a still-PROCESSING provider status) always resolves to the same
 * underlying merchant_wallet_operations row via that table's own
 * (merchant_id, idempotency_key) uniqueness - never a second Speed
 * submission for the same funds.
 */
async function executeBitcoinSweepJob(job: WalletSweepJob): Promise<"confirmed" | "failed" | "processing"> {
  const rule = await getSweepRule(job.merchant_id, job.rule_id)
  if (!rule) {
    await transitionJob(job, "BLOCKED", "sweep_rule_not_found")
    return "failed"
  }

  try {
    const idempotencyKey = `withdrawal-for-sweep:${job.id}`
    const result = await submitCanonicalWithdrawal({
      merchantId: job.merchant_id,
      rail: "bitcoin",
      asset: "BTC",
      amountDecimal: job.amount_decimal,
      source: "automatic_sweep",
      idempotencyKey,
      destinationId: rule.destination_id,
    })

    if (result.kind !== "executed") {
      await transitionJob(job, "FAILED", "unexpected_review_required_result")
      await markSweepRuleExecutionResult(job.rule_id, "failure", "unexpected_review_required_result")
      return "failed"
    }

    await updateSweepJob(job.id, {
      withdrawalSourceTable: "merchant_wallet_operations",
      withdrawalId: result.write.operation.id,
    })

    const status = result.write.operation.status
    if (status === "COMPLETED") {
      await transitionJob(job, "CONFIRMED", null)
      await markSweepRuleExecutionResult(job.rule_id, "success")
      return "confirmed"
    }
    if (status === "FAILED" || status === "CANCELED" || status === "EXPIRED") {
      const reason = result.write.operation.failureReason || "provider_reported_failure"
      await transitionJob(job, "FAILED", reason)
      await markSweepRuleExecutionResult(job.rule_id, "failure", reason)
      return "failed"
    }

    // Still settling at the provider (PENDING/PROCESSING/CREATED/REQUIRES_ACTION)
    // - leave the job PROCESSING. The next cron tick calls this function
    // again with the same idempotency key, which returns the SAME operation
    // (no resubmission) and re-checks whether it has since settled.
    await insertSweepEvent({ jobId: job.id, fromStatus: "PROCESSING", toStatus: "PROCESSING", reason: "provider_still_processing" })
    return "processing"
  } catch (error) {
    const status = (error as { status?: number }).status
    const message = error instanceof Error ? error.message : String(error)
    // 4xx (validation, insufficient balance/gas, destination problems) are
    // permanent - retrying without merchant intervention would just fail
    // the same way again. Anything else (network timeout, 5xx, provider
    // unavailable) is retryable.
    const isPermanent = typeof status === "number" && status >= 400 && status < 500 && status !== 429

    if (isPermanent || job.attempt_count >= getSweepMaxAttempts()) {
      await transitionJob(job, "FAILED", message)
      await markSweepRuleExecutionResult(job.rule_id, "failure", message)
      return "failed"
    }

    await updateSweepJob(job.id, { status: "QUEUED", failureReason: message })
    await insertSweepEvent({ jobId: job.id, fromStatus: "PROCESSING", toStatus: "QUEUED", reason: `retryable_error: ${message}` })
    return "processing"
  }
}

/**
 * Re-confirms a claimed Base/Solana job is still fundable (native gas
 * available) and releases it back to QUEUED/AWAITING_GAS - never submits.
 */
async function releaseBrowserSignedSweepJob(job: WalletSweepJob): Promise<"queued" | "awaiting_gas"> {
  const estimate = await estimateMaxWithdrawalAmount(job.merchant_id, job.rail, job.asset).catch(() => null)
  const ready = Boolean(estimate && !estimate.blocked)
  const toStatus: SweepJobStatus = ready ? "QUEUED" : "AWAITING_GAS"
  await updateSweepJob(job.id, { status: toStatus, failureReason: ready ? null : (estimate?.warning ?? "insufficient_native_gas") })
  await insertSweepEvent({
    jobId: job.id,
    fromStatus: "PROCESSING",
    toStatus,
    reason: ready ? "awaiting_client_signature" : (estimate?.warning ?? "insufficient_native_gas"),
  })
  return ready ? "queued" : "awaiting_gas"
}

export type ProcessClaimedSweepJobsResult = {
  confirmed: number
  failed: number
  awaitingClientSignature: number
  awaitingGas: number
  stillProcessing: number
}

/**
 * Processes a batch of already-claimed (PROCESSING) jobs. Bitcoin jobs
 * execute immediately server-side; Base/Solana jobs are released back to
 * QUEUED/AWAITING_GAS for client-side completion. One job's failure never
 * blocks the rest of the batch.
 */
export async function processClaimedSweepJobs(jobs: WalletSweepJob[]): Promise<ProcessClaimedSweepJobsResult> {
  const result: ProcessClaimedSweepJobsResult = {
    confirmed: 0,
    failed: 0,
    awaitingClientSignature: 0,
    awaitingGas: 0,
    stillProcessing: 0,
  }

  for (const job of jobs) {
    try {
      if (job.rail === "bitcoin") {
        const outcome = await executeBitcoinSweepJob(job)
        if (outcome === "confirmed") result.confirmed++
        else if (outcome === "failed") result.failed++
        else result.stillProcessing++
      } else {
        const outcome = await releaseBrowserSignedSweepJob(job)
        if (outcome === "queued") result.awaitingClientSignature++
        else result.awaitingGas++
      }
    } catch (error) {
      console.warn("[walletSweepExecution] job processing threw", { jobId: job.id, error })
      result.stillProcessing++
    }
  }

  return result
}

/**
 * Called by the client auto-continue hook after it has driven the existing
 * prepare -> sign -> complete flow to a terminal state for a Base/Solana
 * job. Records the resulting wallet_withdrawal_requests reference on the
 * job and the rule's execution result.
 */
export async function recordClientSweepJobOutcome(
  merchantId: string,
  jobId: string,
  outcome: { status: "CONFIRMED" | "FAILED"; withdrawalId: string; failureReason?: string | null }
): Promise<void> {
  const job = await getSweepJobForMerchant(merchantId, jobId)
  if (!job) throw Object.assign(new Error("Sweep job not found."), { status: 404 })

  await updateSweepJob(job.id, {
    status: outcome.status,
    withdrawalSourceTable: "wallet_withdrawal_requests",
    withdrawalId: outcome.withdrawalId,
    failureReason: outcome.status === "FAILED" ? (outcome.failureReason ?? "client_reported_failure") : null,
  })
  await insertSweepEvent({
    jobId: job.id,
    fromStatus: job.status,
    toStatus: outcome.status,
    reason: outcome.status === "FAILED" ? outcome.failureReason ?? "client_reported_failure" : null,
  })
  await markSweepRuleExecutionResult(
    job.rule_id,
    outcome.status === "CONFIRMED" ? "success" : "failure",
    outcome.failureReason ?? undefined
  )
}
