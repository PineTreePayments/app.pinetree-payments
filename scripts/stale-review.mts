/**
 * Admin stale payment review script.
 * Run: npx tsx --tsconfig tsconfig.json scripts/stale-review.mts
 *
 * Environment: reads .env.local for SUPABASE vars before running.
 * Pass --execute to actually apply mutations (default is dry-run).
 */

// Load .env.local before any Supabase imports
import { readFileSync } from "node:fs"
import { resolve as pathResolve } from "node:path"

try {
  const raw = readFileSync(pathResolve(process.cwd(), ".env.local"), "utf-8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
  console.log("[env] Loaded .env.local\n")
} catch {
  console.warn("[env] .env.local not found or unreadable — relying on existing process.env\n")
}

// Dynamic imports so env vars are set before Supabase client initialises
const { getAdminStaleDiagnostic } = await import("../database/adminReports")
const { updatePaymentStatus } = await import("../engine/updatePaymentStatus")

const EXECUTE = process.argv.includes("--execute")
const LINE = "─".repeat(64)

// ─── Task 1: diagnostic ───────────────────────────────────────────────────────

console.log(`\n${LINE}`)
console.log("PINETREE  —  STALE PAYMENT REVIEW")
console.log(LINE)
console.log(`Mode:      ${EXECUTE ? "EXECUTE — mutations WILL be applied" : "DRY RUN  — no mutations"}`)
console.log(`Timestamp: ${new Date().toISOString()}\n`)

const { rows, summary, generatedAt } = await getAdminStaleDiagnostic()

console.log("TASK 1 — STALE PAYMENT SUMMARY")
console.log(`  Total stale:             ${summary.totalStale}`)
console.log(`  Eligible for INCOMPLETE: ${summary.eligibleCount}   (PENDING > 60 min, state-machine-safe)`)
console.log(`  Review required:         ${summary.reviewRequiredCount}   (CREATED > 30 min or PROCESSING > 24 h)`)
console.log(`  Generated at:            ${generatedAt}`)

console.log("\n  By status:")
for (const [status, count] of Object.entries(summary.byStatus).sort()) {
  console.log(`    ${status.padEnd(14)} ${count}`)
}

console.log("\n  By age bucket:")
const AGE_ORDER = ["under_15m", "15m_1h", "1h_24h", "1d_7d", "over_7d"]
const AGE_LABELS: Record<string, string> = {
  under_15m: "< 15 min      ",
  "15m_1h":  "15 min – 1 hr ",
  "1h_24h":  "1 hr – 24 hr  ",
  "1d_7d":   "1 – 7 days    ",
  over_7d:   "> 7 days      ",
}
for (const b of AGE_ORDER) {
  const c = summary.byAgeBucket[b] ?? 0
  console.log(`    ${AGE_LABELS[b] ?? b}  ${c}`)
}

console.log("\n  By network:")
for (const [net, count] of Object.entries(summary.byNetwork).sort()) {
  console.log(`    ${net.padEnd(22)} ${count}`)
}

console.log("\n  By payment mode:")
console.log(`    test         ${summary.testCount}`)
console.log(`    live         ${summary.liveCount}`)
console.log(`    untagged     ${summary.untaggedCount}`)
if (summary.oldestCreatedAt) {
  console.log(`\n  Oldest stale row: ${summary.oldestCreatedAt}`)
}

// ─── Task 2: classify groups ──────────────────────────────────────────────────

console.log(`\n${LINE}`)
console.log("TASK 2 — GROUP CLASSIFICATION\n")

const pendingEligible   = rows.filter((r) => r.eligibility === "eligible_for_incomplete")
const createdReview     = rows.filter((r) => r.eligibility === "review_required" && r.status === "CREATED")
const processingReview  = rows.filter((r) => r.eligibility === "review_required" && r.status === "PROCESSING")
const recentRows        = rows.filter((r) => r.eligibility === "recent_payment_not_eligible")

function tally(arr: typeof rows): string {
  const byNet = arr.reduce<Record<string, number>>((a, r) => {
    const k = r.network ?? "unknown"; a[k] = (a[k] ?? 0) + 1; return a
  }, {})
  const byMode = arr.reduce<Record<string, number>>((a, r) => {
    a[r.payment_mode] = (a[r.payment_mode] ?? 0) + 1; return a
  }, {})
  return `net=${JSON.stringify(byNet)} mode=${JSON.stringify(byMode)}`
}

console.log(`A. Safe to mark INCOMPLETE — ${pendingEligible.length} row(s)`)
console.log(`   (PENDING > 60 min, PENDING→INCOMPLETE is valid per state machine)`)
if (pendingEligible.length > 0) console.log(`   ${tally(pendingEligible)}`)
console.log(`   With provider_reference:    ${pendingEligible.filter((r) => r.hasReference).length}`)
console.log(`   Without provider_reference: ${pendingEligible.filter((r) => !r.hasReference).length}`)

console.log(`\nB. Review only (CREATED > 30 min) — ${createdReview.length} row(s)`)
console.log(`   CREATED→INCOMPLETE is NOT a valid state machine transition.`)
if (createdReview.length > 0) console.log(`   ${tally(createdReview)}`)

console.log(`\nC. Manual investigation required (PROCESSING > 24 h) — ${processingReview.length} row(s)`)
if (processingReview.length > 0) {
  for (const r of processingReview) {
    const ageH = ((Date.now() - new Date(r.created_at).getTime()) / 3_600_000).toFixed(1)
    console.log(`   [PROC] id=${r.id} net=${r.network ?? "?"} ref=${r.hasReference} lastEvt=${r.latestEventType ?? "none"} age=${ageH}h mode=${r.payment_mode}`)
  }
}

console.log(`\nD. Leave alone (under threshold / recent) — ${recentRows.length} row(s)`)
if (recentRows.length > 0) {
  const byStatus = recentRows.reduce<Record<string, number>>((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1; return a
  }, {})
  console.log(`   By status: ${JSON.stringify(byStatus)}`)
}

// ─── Task 3: preview ─────────────────────────────────────────────────────────

console.log(`\n${LINE}`)
console.log("TASK 3 — PREVIEW SAFE CLEANUP\n")

const nowMs = Date.now()
const safeToMark: typeof pendingEligible = []
const previewSkipped: Array<{ id: string; reason: string }> = []

for (const r of pendingEligible) {
  const ageMin = (nowMs - new Date(r.created_at).getTime()) / 60_000

  if (r.status !== "PENDING") {
    previewSkipped.push({ id: r.id, reason: `status=${r.status} (not PENDING)` }); continue
  }
  if (ageMin < 60) {
    previewSkipped.push({ id: r.id, reason: `${ageMin.toFixed(1)} min old — under 60 min threshold` }); continue
  }
  // Extra caution: if there's a provider reference AND a processing or confirmed event, skip
  if (r.hasReference) {
    const evt = r.latestEventType ?? ""
    if (evt === "payment.processing" || evt === "payment.confirmed") {
      previewSkipped.push({ id: r.id, reason: `has ref + latest evt=${evt} — possible live chain activity` }); continue
    }
  }
  safeToMark.push(r)
}

if (safeToMark.length === 0 && previewSkipped.length === 0) {
  console.log("No eligible rows to preview.")
} else {
  console.log(`Safe to mark INCOMPLETE: ${safeToMark.length}`)
  for (const r of safeToMark) {
    const ageH = ((nowMs - new Date(r.created_at).getTime()) / 3_600_000).toFixed(1)
    console.log(`  [ELIGIBLE] ${r.id} | ${r.status} | ${r.network ?? "unknown"} | ${ageH}h | mode=${r.payment_mode} | lastEvt=${r.latestEventType ?? "none"} | ref=${r.hasReference}`)
  }
  if (previewSkipped.length > 0) {
    console.log(`\nSkipped in preview: ${previewSkipped.length}`)
    for (const s of previewSkipped) {
      console.log(`  [SKIP] ${s.id}: ${s.reason}`)
    }
  }
}

// ─── Task 4: mark INCOMPLETE ─────────────────────────────────────────────────

console.log(`\n${LINE}`)
console.log("TASK 4 — MARK ELIGIBLE PENDING ROWS INCOMPLETE\n")

const changed: string[] = []
const mutationFailed: Array<{ id: string; error: string }> = []

if (safeToMark.length === 0) {
  console.log("No eligible rows to mark INCOMPLETE.")
} else if (!EXECUTE) {
  console.log(`DRY RUN: would mark ${safeToMark.length} PENDING payment(s) INCOMPLETE.`)
  console.log("Re-run with --execute to apply the mutation.\n")
} else {
  console.log(`Executing ${safeToMark.length} mutation(s)…\n`)
  for (const r of safeToMark) {
    try {
      await updatePaymentStatus(r.id, "INCOMPLETE", {
        providerEvent: "admin.stale-cleanup",
        rawPayload: { adminAction: true, reason: "pending_no_activity_timeout", script: "stale-review.mts" },
      })
      changed.push(r.id)
      console.log(`  [CHANGED] ${r.id} → INCOMPLETE`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      mutationFailed.push({ id: r.id, error: msg })
      console.log(`  [FAILED]  ${r.id}: ${msg}`)
    }
  }
  console.log(`\nMutation complete: changed=${changed.length} failed=${mutationFailed.length}`)
}

// ─── Task 5: CREATED row recommendation ──────────────────────────────────────

console.log(`\n${LINE}`)
console.log("TASK 5 — CREATED ROW RECOMMENDATION\n")

if (createdReview.length === 0) {
  console.log("No stale CREATED rows — no action needed.")
} else {
  const allTest = createdReview.every((r) => r.payment_mode === "test")
  console.log(`${createdReview.length} CREATED row(s) older than 30 minutes.`)
  console.log(`All test-tagged: ${allTest}`)
  console.log()
  console.log("STATE MACHINE CONSTRAINT: CREATED → INCOMPLETE is not a valid transition.")
  console.log("  Valid path from CREATED: CREATED → PENDING → INCOMPLETE (two writes).")
  console.log()
  console.log("RECOMMENDATION:")
  console.log("  Option 1 [preferred]: Leave stale CREATED rows as-is.")
  console.log("    They are inert — merchants never see CREATED status. The admin overview")
  console.log("    counts them in 'awaiting', but this is cosmetic noise, not a real problem.")
  console.log()
  console.log("  Option 2 [future, safe]: Add CREATED → INCOMPLETE to the state machine.")
  console.log("    This is a 2-line change to engine/paymentStateMachine.ts:")
  console.log("    CREATED: [\"PENDING\", \"INCOMPLETE\"]")
  console.log("    Requires: team review, tsc pass, and regression test before shipping.")
  console.log()
  console.log("  Option 3 [future, safe 2-step]: Admin migration script does:")
  console.log("    CREATED → PENDING, then PENDING → INCOMPLETE per row.")
  console.log("    Two DB writes + two audit events per payment. Noisier but fully state-machine-safe.")
  console.log()
  console.log("  DO NOT implement automatically. Review with team before any bulk CREATED migration.")
}

// ─── Task 6: PROCESSING row review ───────────────────────────────────────────

console.log(`\n${LINE}`)
console.log("TASK 6 — PROCESSING ROW REVIEW\n")

if (processingReview.length === 0) {
  console.log("No stale PROCESSING rows (> 24 h) — no action needed.")
} else {
  console.log(`${processingReview.length} PROCESSING row(s) older than 24 hours:\n`)
  for (const r of processingReview) {
    const ageH = ((Date.now() - new Date(r.created_at).getTime()) / 3_600_000).toFixed(1)
    let assessment: string
    const hasEvt = Boolean(r.latestEventType)

    if (!r.hasReference && !hasEvt) {
      assessment = "likely orphaned — no provider reference and no events; safe to investigate"
    } else if (!r.hasReference && r.latestEventType === "payment.processing") {
      assessment = "likely stuck watcher — processing event fired but provider never confirmed"
    } else if (r.hasReference && (r.latestEventType === "payment.processing" || !hasEvt)) {
      assessment = "likely real payment requiring investigation — has provider reference; check chain/provider manually"
    } else if (r.payment_mode === "test") {
      assessment = "likely test/dev leftover — low urgency, investigate and manually resolve"
    } else {
      assessment = "unknown — manual review required"
    }

    console.log(`  ID:           ${r.id}`)
    console.log(`  Network:      ${r.network ?? "unknown"}`)
    console.log(`  Mode:         ${r.payment_mode}`)
    console.log(`  Has ref:      ${r.hasReference}`)
    console.log(`  Latest event: ${r.latestEventType ?? "none"} @ ${r.latestEventAt ?? "n/a"}`)
    console.log(`  Age:          ${ageH}h  (created ${r.created_at})`)
    console.log(`  Assessment:   ${assessment}`)
    console.log()
  }
  console.log("ACTION: Do NOT auto-mutate PROCESSING rows. Inspect each on the chain/provider dashboard.")
}

// ─── Task 7: final status report ─────────────────────────────────────────────

console.log(LINE)
console.log("TASK 7 — FINAL STATUS REPORT\n")

console.log(`  1. Total stale rows reviewed:              ${summary.totalStale}`)
console.log(`  2. Rows marked INCOMPLETE:                 ${EXECUTE ? changed.length : safeToMark.length + " (pending --execute)"}`)
console.log(`  3. Rows skipped (ineligible/cautious):     ${summary.totalStale - safeToMark.length}`)
console.log(`  4. CREATED rows requiring future handling: ${createdReview.length}`)
console.log(`  5. PROCESSING rows needing manual review:  ${processingReview.length}`)
console.log(`  6. Recent rows left untouched:             ${recentRows.length}`)
console.log(`  7. Expected admin count reduction:         ${safeToMark.length} rows removed from 'stale' bucket`)
console.log(`  8. Execution/watcher/state-machine logic:  NOT modified`)
console.log(`  9. CONFIRMED payments touched:             NONE`)

console.log(`\n${LINE}\n`)
