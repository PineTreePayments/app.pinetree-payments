/**
 * Bounded historical repair for payment outcomes previously collapsed into
 * INCOMPLETE. Payment ids are always explicit; dry-run is the default.
 *
 * Inspect only:
 *   npx tsx --tsconfig tsconfig.json scripts/reconcile-collapsed-payment-outcomes.mts <paymentId> [paymentId...]
 *
 * Apply through the Engine/Data compare-and-set boundary:
 *   npx tsx --tsconfig tsconfig.json scripts/reconcile-collapsed-payment-outcomes.mts <paymentId> [paymentId...] --apply
 */
import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"

for (const filename of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(resolvePath(process.cwd(), filename), "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]]) continue
      let value = match[2]
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[match[1]] = value
    }
  } catch {
    // The next candidate may exist; otherwise existing process env is used.
  }
}

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const unknownFlags = args.filter((arg) => arg.startsWith("--") && arg !== "--apply")
const suppliedPaymentIds = args.filter((arg) => !arg.startsWith("--"))
const paymentIds = [...new Set(suppliedPaymentIds)]
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

if (
  unknownFlags.length > 0 ||
  paymentIds.length === 0 ||
  paymentIds.some((paymentId) => !uuidPattern.test(paymentId))
) {
  console.error(
    "Usage: reconcile-collapsed-payment-outcomes.mts <paymentId> [paymentId...] [--apply]"
  )
  process.exit(1)
}

const { reconcileHistoricalCollapsedPaymentOutcome } = await import(
  "../engine/paymentReconciliation"
)

const preflight = []
for (const paymentId of paymentIds) {
  preflight.push(await reconcileHistoricalCollapsedPaymentOutcome(paymentId))
}

const actionable = preflight.filter((result) => result.candidate && !result.idempotent)
const refused = preflight.filter((result) => !result.candidate)
console.log(JSON.stringify({
  mode: apply ? "apply-preflight" : "dry-run",
  requestedCount: paymentIds.length,
  candidateCount: preflight.filter((result) => result.candidate).length,
  actionableCount: actionable.length,
  idempotentCount: preflight.filter((result) => result.idempotent).length,
  refusedCount: refused.length,
  preservedRawEvents: true,
  linkedTransactionsMutated: false,
  ledgerWritesRequested: false,
  results: preflight,
}, null, 2))

if (!apply) process.exit(0)

// Do not partially apply a requested batch whose preflight contains an unsafe
// or missing id. A fresh per-row compare-and-set still guards every write.
if (refused.length > 0) {
  console.error(JSON.stringify({
    applied: false,
    applyAborted: true,
    reason: "one_or_more_payment_ids_refused_preflight",
    refused: refused.map((result) => ({ paymentId: result.paymentId, reason: result.reason })),
  }, null, 2))
  process.exit(2)
}

const appliedResults = []
for (const candidate of actionable) {
  appliedResults.push(await reconcileHistoricalCollapsedPaymentOutcome(candidate.paymentId, { apply: true }))
}

const failedApplies = appliedResults.filter((result) => !result.changed)
console.log(JSON.stringify({
  applied: failedApplies.length === 0,
  requestedCount: paymentIds.length,
  changedCount: appliedResults.filter((result) => result.changed).length,
  idempotentCount: preflight.filter((result) => result.idempotent).length,
  failedCount: failedApplies.length,
  preservedRawEvents: true,
  linkedTransactionsMutated: false,
  ledgerWritesRequested: false,
  results: appliedResults,
}, null, 2))

if (failedApplies.length > 0) process.exitCode = 2
