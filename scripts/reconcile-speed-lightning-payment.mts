/**
 * Bounded Speed Lightning reconciliation for one canonical payment.
 *
 * Dry run (default; provider and database reads only):
 *   npx tsx --tsconfig tsconfig.json scripts/reconcile-speed-lightning-payment.mts <paymentId>
 *
 * Apply through the Engine lifecycle path:
 *   npx tsx --tsconfig tsconfig.json scripts/reconcile-speed-lightning-payment.mts <paymentId> --apply
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

const paymentId = String(process.argv[2] || "").trim()
const apply = process.argv.includes("--apply")
if (!/^[a-zA-Z0-9-]{1,64}$/.test(paymentId)) {
  console.error("Usage: reconcile-speed-lightning-payment.mts <paymentId> [--apply]")
  process.exit(1)
}

const [{ getPaymentById }, { getPaymentEvents }, { getPaymentIntentByPaymentId }] = await Promise.all([
  import("../database/payments"),
  import("../database/paymentEvents"),
  import("../database/paymentIntents"),
])
const [{ retrieveMerchantSpeedPayment }, speedClient, { getCanonicalTransactionById }] = await Promise.all([
  import("../providers/lightning/speedAdapter"),
  import("../providers/lightning/speedClient"),
  import("../engine/canonicalTransactions"),
])

const payment = await getPaymentById(paymentId)
if (!payment) throw new Error(`Payment ${paymentId} was not found`)

const statusBefore = String(payment.status || "").toUpperCase()
const provider = String(payment.provider || "").toLowerCase()
const network = String(payment.network || "").toLowerCase()
const providerReference = String(payment.provider_reference || "").trim()
const isLightning = provider === "lightning_speed" || network === "bitcoin_lightning"
const isCandidate = isLightning && ["CREATED", "PENDING", "PROCESSING"].includes(statusBefore) && Boolean(providerReference)

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  candidateCount: isCandidate ? 1 : 0,
  paymentId,
  statusBefore,
  provider,
  network,
  providerReference,
}, null, 2))

if (!isCandidate) {
  console.log(JSON.stringify({
    changed: false,
    reason: isLightning
      ? `not_reconcilable_from_${statusBefore || "UNKNOWN"}`
      : "not_speed_lightning",
  }, null, 2))
  process.exit(0)
}

type ProviderPayment = Awaited<ReturnType<typeof retrieveMerchantSpeedPayment>>
let speedPayment: ProviderPayment
let evidenceSource = "merchant_connected_account"
try {
  speedPayment = await retrieveMerchantSpeedPayment(providerReference, payment.merchant_id)
} catch (error) {
  const status = Number((error as { status?: unknown })?.status || 0)
  if (status !== 404) throw error
  speedPayment = await speedClient.retrieveSpeedPayment(providerReference)
  evidenceSource = "legacy_platform"
}

const metadata = speedPayment.metadata && typeof speedPayment.metadata === "object"
  ? speedPayment.metadata as Record<string, unknown>
  : {}
const evidencePaymentId = String(metadata.pineTreePaymentId || metadata.payment_id || "").trim()
const evidenceMerchantId = String(metadata.merchantId || metadata.merchant_id || "").trim()
const identityMatches = String(speedPayment.id || "").trim() === providerReference &&
  evidencePaymentId === paymentId &&
  evidenceMerchantId === payment.merchant_id
if (!identityMatches) {
  throw new Error("Speed evidence identity mismatch; refusing reconciliation")
}

const providerStatus = String(speedPayment.status || "").toLowerCase()
const detected = speedClient.isSpeedPaymentPaid(speedPayment)
const proposedStatus = detected
  ? "CONFIRMED"
  : providerStatus === "processing" || providerStatus === "settling"
    ? "PROCESSING"
    : providerStatus === "expired"
      ? "EXPIRED"
      : providerStatus === "canceled" || providerStatus === "cancelled"
        ? "CANCELED"
        : null
console.log(JSON.stringify({
  evidence: {
    source: evidenceSource,
    providerPaymentId: speedPayment.id,
    providerStatus,
    canonicalPaymentId: evidencePaymentId,
    merchantId: evidenceMerchantId,
    identityMatches,
  },
  proposed: {
    oldValue: statusBefore,
    newValue: proposedStatus,
    reason: `speed_${providerStatus || "unknown"}`,
    ledgerWriteMayBeRequested: proposedStatus === "CONFIRMED",
  },
}, null, 2))

if (!apply) {
  console.log(JSON.stringify({ changed: false, dryRun: true, preservedRawEvents: true }, null, 2))
  process.exit(0)
}

const { reconcileSpeedLightningPayment } = await import("../engine/lightningSpeedReconciliation")
const result = await reconcileSpeedLightningPayment({
  id: payment.id,
  status: payment.status,
  provider_reference: payment.provider_reference,
  merchant_id: payment.merchant_id,
}, {
  speedPayment,
  retrievalScope: evidenceSource === "legacy_platform" ? "legacy_platform" : "merchant_connected_account",
})
const [paymentAfter, intentAfter, eventsAfter, canonicalAfter] = await Promise.all([
  getPaymentById(paymentId),
  getPaymentIntentByPaymentId(paymentId),
  getPaymentEvents(paymentId),
  getCanonicalTransactionById(paymentId, { scope: { type: "admin" } }),
])

console.log(JSON.stringify({
  applied: true,
  result,
  correction: {
    paymentId,
    oldValue: statusBefore,
    newValue: paymentAfter?.status || null,
    reason: `speed_${providerStatus}`,
    evidenceSource,
    providerStatusApplied: providerStatus,
  },
  verification: {
    canonicalStatus: canonicalAfter?.canonicalStatus || null,
    transactionStatus: canonicalAfter?.raw.transactionStatus || null,
    paymentIntentStatus: intentAfter?.status || null,
    eventCount: eventsAfter.length,
    latestEvent: eventsAfter.at(-1)?.event_type || null,
    rawEventsPreserved: true,
    ledgerWritesRequested: proposedStatus === "CONFIRMED",
  },
}, null, 2))
