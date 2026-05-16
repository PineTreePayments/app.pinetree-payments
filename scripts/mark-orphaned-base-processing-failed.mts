/**
 * Admin cleanup script — mark 10 verified orphaned Base PROCESSING payments as FAILED.
 *
 * These 10 payments were individually reviewed and found to have no on-chain activity:
 *   - eth_getTransactionByHash returned null for all stored txHashes on Base mainnet
 *   - eth_getTransactionReceipt returned null for all stored txHashes on Base mainnet
 *   - Root cause: Alchemy ADDRESS_ACTIVITY webhook matched these stale payments by wallet
 *     address only — the txHash stored in raw_payload belongs to a different payment
 *
 * Run (dry-run, default):
 *   npx tsx --tsconfig tsconfig.json scripts/mark-orphaned-base-processing-failed.mts
 *
 * Run (execute):
 *   npx tsx --tsconfig tsconfig.json scripts/mark-orphaned-base-processing-failed.mts --execute
 */

// Load .env.local before any Supabase imports — mirrors stale-review.mts pattern
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

const { getPaymentById } = await import("../database/payments")
const { getPaymentEvents } = await import("../database/paymentEvents")
const { updatePaymentStatus } = await import("../engine/updatePaymentStatus")
const { getRpcUrl } = await import("../engine/config")

const EXECUTE = process.argv.includes("--execute")
const LINE = "─".repeat(68)
const REVIEWED_AT = new Date().toISOString()

// The 10 verified orphaned Base PROCESSING payment IDs.
// DO NOT add IDs here without individual on-chain verification.
const ORPHANED_IDS = [
  "8fca3a83-87d4-492d-82e1-92fedfa6f31d",
  "4a7cc1b2-e60f-4852-81dc-93a97c6867dd",
  "d39470ab-1217-4875-8a86-09780004e90c",
  "36182d02-e9e2-4f1d-bf7d-c60d839e325a",
  "89953c06-c621-4e3b-ab38-10db290c9faa",
  "be64fc1a-4a6e-40e0-8929-6195968c0751",
  "4d31dc6e-9051-4fa8-99de-84013b873d33",
  "c453802c-4c61-4dfa-83b4-ff2968ac4fb5",
  "18f952de-5770-48c1-a5d6-612542a698b8",
  "e31c237f-c8a4-4cf2-b0b5-9ffbb3f4b0bd",
] as const

// ─── RPC helper for on-chain re-check ────────────────────────────────────────

async function txExistsOnChain(rpcUrl: string, txHash: string): Promise<boolean> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionByHash",
        params: [txHash],
        id: 1
      })
    })
    const data = await res.json() as { result?: unknown }
    return data.result !== null && data.result !== undefined
  } catch {
    return false
  }
}

// ─── Extract txHash from payment.processing event raw_payload ─────────────────

function extractTxHashFromEvents(events: Array<{ event_type: string; raw_payload?: unknown }>): string | null {
  const processingEvents = events
    .filter((e) => e.event_type === "payment.processing")
    .reverse()

  for (const evt of processingEvents) {
    const raw = evt.raw_payload as Record<string, unknown> | null
    const hash = String(raw?.txHash || "").trim()
    if (/^0x[a-fA-F0-9]{64}$/.test(hash)) return hash
  }
  return null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n${LINE}`)
console.log("PINETREE — MARK ORPHANED BASE PROCESSING PAYMENTS FAILED")
console.log(LINE)
console.log(`Mode:      ${EXECUTE ? "EXECUTE — mutations WILL be applied" : "DRY RUN  — no mutations"}`)
console.log(`Payments:  ${ORPHANED_IDS.length} (hardcoded, individually reviewed)`)
console.log(`Timestamp: ${REVIEWED_AT}\n`)

let rpcUrl: string
try {
  rpcUrl = getRpcUrl("base")
  console.log(`[rpc] Base RPC configured — on-chain re-check enabled\n`)
} catch {
  console.warn("[rpc] Base RPC not configured — on-chain re-check will be skipped\n")
  rpcUrl = ""
}

const TERMINAL_STATES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "REFUNDED"])

const changed: string[] = []
const skipped: Array<{ id: string; reason: string }> = []
const errored: Array<{ id: string; error: string }> = []

for (const id of ORPHANED_IDS) {
  console.log(`\n${LINE.slice(0, 40)}`)
  console.log(`ID: ${id}`)

  // ── Guard 1: fetch payment ─────────────────────────────────────────────────
  let payment: Awaited<ReturnType<typeof getPaymentById>>
  try {
    payment = await getPaymentById(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  [ERROR] fetch failed: ${msg}`)
    errored.push({ id, error: msg })
    continue
  }

  if (!payment) {
    console.log(`  [SKIP] payment not found`)
    skipped.push({ id, reason: "not_found" })
    continue
  }

  const currentStatus = String(payment.status || "").toUpperCase()
  const network = String(payment.network || "").toLowerCase()

  // ── Guard 2: must be Base ──────────────────────────────────────────────────
  if (network !== "base") {
    console.log(`  [SKIP] network=${network} (not base)`)
    skipped.push({ id, reason: `wrong_network:${network}` })
    continue
  }

  // ── Guard 3: must still be PROCESSING ─────────────────────────────────────
  if (currentStatus !== "PROCESSING") {
    console.log(`  [SKIP] status=${currentStatus} (not PROCESSING)`)
    skipped.push({ id, reason: `wrong_status:${currentStatus}` })
    continue
  }

  // ── Guard 4: must not already be terminal ─────────────────────────────────
  if (TERMINAL_STATES.has(currentStatus)) {
    console.log(`  [SKIP] already terminal: ${currentStatus}`)
    skipped.push({ id, reason: `already_terminal:${currentStatus}` })
    continue
  }

  console.log(`  status:  ${currentStatus}`)
  console.log(`  network: ${network}`)
  console.log(`  amount:  ${payment.gross_amount} ${payment.currency}`)

  // ── On-chain re-check ──────────────────────────────────────────────────────
  let txHashInEvent: string | null = null
  let txExistsOnMainnet = false

  try {
    const events = await getPaymentEvents(id)
    txHashInEvent = extractTxHashFromEvents(events)
  } catch {
    // non-fatal — proceed without events
  }

  if (txHashInEvent) {
    console.log(`  txHash (from event): ${txHashInEvent.slice(0, 20)}…`)
    if (rpcUrl) {
      txExistsOnMainnet = await txExistsOnChain(rpcUrl, txHashInEvent)
      console.log(`  on-chain exists:     ${txExistsOnMainnet}`)
    } else {
      console.log(`  on-chain exists:     (skipped — no RPC)`)
    }
  } else {
    console.log(`  txHash: not found in events`)
  }

  // ── Guard 5: abort if tx now exists on-chain (unexpected — needs human review) ──
  if (txExistsOnMainnet) {
    console.log(`  [SKIP] txHash now exists on-chain — requires manual investigation`)
    skipped.push({ id, reason: "tx_found_on_chain_unexpectedly" })
    continue
  }

  // ── Dry-run or execute ─────────────────────────────────────────────────────
  if (!EXECUTE) {
    console.log(`  [DRY RUN] would mark FAILED`)
    changed.push(id) // count as "would change" in dry-run
    continue
  }

  try {
    await updatePaymentStatus(id, "FAILED", {
      providerEvent: "admin.no-chain-activity-cleanup",
      rawPayload: {
        adminAction: true,
        reason: "webhook_address_match_false_positive",
        txHashInEvent: txHashInEvent ?? null,
        txHashExistsOnChain: false,
        reviewedAt: REVIEWED_AT,
        script: "mark-orphaned-base-processing-failed.mts"
      }
    })
    changed.push(id)
    console.log(`  [CHANGED] → FAILED`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  [ERROR] ${msg}`)
    errored.push({ id, error: msg })
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${LINE}`)
console.log(`SUMMARY\n`)
console.log(`  Mode:            ${EXECUTE ? "EXECUTE" : "DRY RUN"}`)
console.log(`  IDs reviewed:    ${ORPHANED_IDS.length}`)
console.log(`  ${EXECUTE ? "Changed" : "Would change"}: ${" ".repeat(EXECUTE ? 4 : 0)}${changed.length}`)
console.log(`  Skipped:         ${skipped.length}`)
console.log(`  Errored:         ${errored.length}`)

if (skipped.length > 0) {
  console.log(`\n  Skipped detail:`)
  for (const s of skipped) {
    console.log(`    ${s.id}: ${s.reason}`)
  }
}

if (errored.length > 0) {
  console.log(`\n  Errored detail:`)
  for (const e of errored) {
    console.log(`    ${e.id}: ${e.error}`)
  }
}

if (!EXECUTE) {
  console.log(`\n  Re-run with --execute to apply mutations.`)
}

console.log(`\n  State machine used:          YES (engine/updatePaymentStatus)`)
console.log(`  CONFIRMED payments touched:  NONE`)
console.log(`  Solana/Lightning touched:    NONE`)
console.log(`  Direct DB writes:            NONE`)
console.log(`\n${LINE}\n`)
