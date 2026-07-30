/**
 * Audited Bitcoin withdrawal destination metadata backfill.
 *
 * Dry run (default; database/provider reads only):
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-bitcoin-withdrawal-destinations.mts
 *
 * Apply verified rows only:
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-bitcoin-withdrawal-destinations.mts --apply
 *
 * Retroactively audit rows whose destination was already backfilled (never
 * touches destination data; add --apply to actually write the audit records):
 *   ... --audit-only
 *   ... --audit-only --apply --original-run-id=<uuid>
 *
 * Useful options:
 *   --limit=100
 *   --batch-size=25
 *   --no-speed-api
 *
 * ── Audit destination ─────────────────────────────────────────────────────
 * Audit evidence is written to `merchant_audit_events` (event type
 * `destination_backfill.verified`, operation id carried in metadata).
 *
 * It is NOT written to `wallet_operation_events`: that table's FK targets the
 * separate `wallet_operations` table, so merchant_wallet_operations ids are
 * rejected. It is also not written to `speed_webhook_events`, which this
 * script reads as a recovery source.
 *
 * ── Atomicity ─────────────────────────────────────────────────────────────
 * supabase-js cannot span a transaction across two tables, so the destination
 * update and the audit insert are separate statements and are REPORTED
 * SEPARATELY. A committed destination update is never reported as failed just
 * because its audit insert failed; such rows are counted as `updated` with
 * `auditFailed`, and `--audit-only` can repair the audit record afterwards.
 */
import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { randomUUID } from "node:crypto"

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
    // Optional local env file.
  }
}

const [
  { supabaseAdmin, supabase: supabaseAnon },
  { maskDestination },
  { classifyBitcoinWithdrawalDestination },
  { getConnectedAccountSendStatus },
  { insertMerchantAuditEventStrict },
] = await Promise.all([
  import("../database/supabase"),
  import("../engine/wallet/walletOperations"),
  import("../providers/wallets/bitcoinWithdrawalDestination"),
  import("../providers/lightning/speedWalletManagement"),
  import("../database/merchantAuditEvents"),
])

const AUDIT_EVENT_TYPE = "destination_backfill.verified" as const

const db = supabaseAdmin || supabaseAnon
const runId = randomUUID()
const apply = process.argv.includes("--apply")
const auditOnly = process.argv.includes("--audit-only")
const includeSpeedApi = !process.argv.includes("--no-speed-api")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1]
const batchArg = process.argv.find((arg) => arg.startsWith("--batch-size="))?.split("=")[1]
const originalRunId = process.argv.find((arg) => arg.startsWith("--original-run-id="))?.split("=")[1] || null
const limit = Math.max(1, Math.min(Number(limitArg || 500), 5_000))
const batchSize = Math.max(1, Math.min(Number(batchArg || 50), 250))
const backfillTimestamp = new Date().toISOString()

type OperationRow = {
  id: string
  merchant_id: string
  provider: string | null
  provider_account_id: string | null
  operation_type: string
  direction: string | null
  status: string | null
  asset: string | null
  network: string | null
  amount_base_units: string | null
  destination_summary: string | null
  destination_address?: string | null
  destination_label?: string | null
  provider_reference: string | null
  provider_transaction_id: string | null
  provider_secondary_reference?: string | null
  raw_provider_status: Record<string, unknown> | null
  source?: string | null
  destination_id?: string | null
  destination_snapshot?: Record<string, unknown> | null
  created_at: string
  updated_at?: string | null
}

type RecoverySource =
  | "canonical_metadata"
  | "provider_response_payload"
  | "raw_event_webhook_inbox"
  | "reconciliation_record"
  | "speed_api_lookup"
  | "saved_destination"

type Candidate = {
  destination: string
  label: string | null
  network: string | null
  providerReference: string | null
  source: RecoverySource
  evidence: string
}

type RowResult = {
  operationId: string
  providerReference: string | null
  source: RecoverySource | null
  status:
    | "verified"
    | "updated"
    | "updated_audit_failed"
    | "audit_inserted"
    | "audit_duplicate"
    | "audit_failed"
    | "skipped"
    | "unresolved"
    | "failed"
  reason: string
  network: string | null
  destinationRedacted?: string | null
  destinationLabelRecovered?: boolean
  maskedVerificationResult?: string | null
}

type Summary = {
  mode: "dry-run" | "apply"
  pass: "destination-backfill" | "retroactive-audit"
  auditTable: string
  auditEventType: string
  runId: string
  scanned: number
  recovered: number
  localRecoverable: number
  requiringSpeedApiLookup: number
  speedApiLookupsAttempted: number
  verified: number
  /** Destination writes that committed. Independent of audit outcome. */
  updated: number
  skipped: number
  unresolved: number
  /** Destination-update failures ONLY. Audit failures are never counted here. */
  failed: number
  auditInserted: number
  auditSkippedDuplicate: number
  auditFailed: number
  bySource: Record<string, number>
}

type AuditSummary = {
  mode: "dry-run" | "apply"
  pass: "retroactive-audit"
  auditTable: string
  auditEventType: string
  runId: string
  originalRunId: string | null
  destinationRowsExamined: number
  remaskVerified: number
  remaskFailed: number
  recoverySourceUnknown: number
  auditInserted: number
  auditSkippedDuplicate: number
  auditFailed: number
  unresolvedRowsUntouched: number
  bySource: Record<string, number>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!isPlainObject(cursor)) return undefined
    cursor = cursor[key]
  }
  return cursor
}

function inferNetworkFromDestination(destination: string): string | null {
  const classified = classifyBitcoinWithdrawalDestination(destination)
  if (!classified.valid) return null
  return classified.method === "onchain" ? "bitcoin_onchain" : "bitcoin_lightning"
}

function compatibleNetwork(rowNetwork: string | null | undefined, candidateNetwork: string | null): boolean {
  const row = String(rowNetwork || "").trim().toLowerCase()
  const candidate = String(candidateNetwork || "").trim().toLowerCase()
  if (!row) return Boolean(candidate)
  if (!candidate) return false
  if (row === candidate) return true
  if (row === "bitcoin" && candidate.startsWith("bitcoin_")) return true
  return false
}

function redactDestination(destination: string): string {
  const trimmed = destination.trim()
  if (trimmed.length <= 10) return "[redacted]"
  return `${trimmed.slice(0, 4)}...[redacted]...${trimmed.slice(-4)}`
}

function candidateFromDestination(input: {
  row: OperationRow
  destination: unknown
  label?: unknown
  network?: unknown
  providerReference?: unknown
  source: RecoverySource
  evidence: string
}): Candidate | null {
  const rawDestination = stringValue(input.destination)
  if (!rawDestination) return null
  const classified = classifyBitcoinWithdrawalDestination(rawDestination)
  if (!classified.valid) return null
  const inferredNetwork = inferNetworkFromDestination(classified.normalized)
  const explicitNetwork = stringValue(input.network)
  const network = explicitNetwork || inferredNetwork
  const providerReference = stringValue(input.providerReference) || input.row.provider_reference || input.row.provider_transaction_id || null
  return {
    destination: classified.normalized,
    label: stringValue(input.label),
    network,
    providerReference,
    source: input.source,
    evidence: input.evidence,
  }
}

function candidatesFromKnownObject(row: OperationRow, object: unknown, source: RecoverySource, evidence: string): Candidate[] {
  if (!isPlainObject(object)) return []
  const paths: Array<{ destination: string[]; label?: string[]; network?: string[]; providerReference?: string[] }> = [
    { destination: ["destination_address"], label: ["label"], network: ["network"], providerReference: ["provider_reference"] },
    { destination: ["destinationAddress"], label: ["label"], network: ["network"], providerReference: ["providerReference"] },
    { destination: ["withdraw_request"], network: ["withdraw_method"], providerReference: ["id"] },
    { destination: ["withdrawRequest"], network: ["withdrawMethod"], providerReference: ["id"] },
    { destination: ["withdrawal", "destination_address"], label: ["withdrawal", "destination_label"], network: ["withdrawal", "network"], providerReference: ["withdrawal", "provider_reference"] },
    { destination: ["destination", "destination_address"], label: ["destination", "label"], network: ["destination", "network"], providerReference: ["id"] },
    { destination: ["data", "object", "withdraw_request"], network: ["data", "object", "withdraw_method"], providerReference: ["data", "object", "reference_id"] },
    { destination: ["data", "object", "destination_address"], label: ["data", "object", "destination_label"], network: ["data", "object", "network"], providerReference: ["data", "object", "reference_id"] },
  ]
  return paths
    .map((path) => candidateFromDestination({
      row,
      destination: readPath(object, path.destination),
      label: path.label ? readPath(object, path.label) : null,
      network: path.network ? readPath(object, path.network) : null,
      providerReference: path.providerReference ? readPath(object, path.providerReference) : null,
      source,
      evidence: `${evidence}:${path.destination.join(".")}`,
    }))
    .filter(Boolean) as Candidate[]
}

function normalizeSpeedNetwork(value: string | null): string | null {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "onchain" || normalized === "bitcoin_onchain") return "bitcoin_onchain"
  if (normalized === "lightning" || normalized === "bitcoin_lightning") return "bitcoin_lightning"
  return normalized || null
}

function verifyCandidate(row: OperationRow, candidate: Candidate): { ok: true; candidate: Candidate; masked: string } | { ok: false; reason: string } {
  const summary = String(row.destination_summary || "").trim()
  if (!summary) return { ok: false, reason: "missing_destination_summary" }
  const classified = classifyBitcoinWithdrawalDestination(candidate.destination)
  if (!classified.valid) return { ok: false, reason: "recovered_destination_invalid" }
  const normalizedNetwork = normalizeSpeedNetwork(candidate.network) || inferNetworkFromDestination(classified.normalized)
  if (!compatibleNetwork(row.network, normalizedNetwork)) return { ok: false, reason: "network_mismatch" }
  const rowReference = String(row.provider_reference || row.provider_transaction_id || "").trim()
  const candidateReference = String(candidate.providerReference || "").trim()
  if (rowReference && candidateReference && rowReference !== candidateReference) {
    return { ok: false, reason: "provider_reference_mismatch" }
  }
  const masked = maskDestination(classified.normalized)
  if (masked !== summary) return { ok: false, reason: "masked_summary_mismatch" }
  return { ok: true, candidate: { ...candidate, destination: classified.normalized, network: normalizedNetwork }, masked }
}

async function loadHistoricalRows(mode: "missing-destination" | "populated-destination" = "missing-destination"): Promise<OperationRow[]> {
  const rows: OperationRow[] = []
  for (let from = 0; rows.length < limit; from += batchSize) {
    const to = Math.min(from + batchSize - 1, limit - 1)
    let query = db
      .from("merchant_wallet_operations")
      .select("*")
      .eq("operation_type", "WITHDRAWAL")
    query = mode === "populated-destination"
      ? query.not("destination_address", "is", null)
      : query.is("destination_address", null)
    const { data, error } = await query
      .order("created_at", { ascending: true })
      .range(from, to)
    if (error) throw new Error(`Failed to load merchant_wallet_operations: ${error.message}`)
    const page = (data || []) as OperationRow[]
    rows.push(...page)
    if (page.length < batchSize) break
  }
  return rows.slice(0, limit)
}

async function countUnresolvedWithdrawals(): Promise<number> {
  const { count, error } = await db
    .from("merchant_wallet_operations")
    .select("id", { count: "exact", head: true })
    .eq("operation_type", "WITHDRAWAL")
    .is("destination_address", null)
  if (error) throw new Error(`Failed to count unresolved withdrawals: ${error.message}`)
  return count || 0
}

async function candidatesFromWebhookInbox(row: OperationRow): Promise<Candidate[]> {
  const references = [row.provider_reference, row.provider_transaction_id, row.provider_secondary_reference]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
  let query = db
    .from("speed_webhook_events")
    .select("*")
    .eq("merchant_id", row.merchant_id)
    .order("received_at", { ascending: true })
    .limit(25)
  if (row.id) query = query.eq("wallet_operation_id", row.id)
  const { data, error } = await query
  if (error) return []
  const matched = ((data || []) as Array<Record<string, unknown>>).filter((event) => {
    if (event.wallet_operation_id === row.id) return true
    const payload = event.raw_payload
    const text = payload ? JSON.stringify(payload) : ""
    return references.some((reference) => text.includes(reference))
  })
  return matched.flatMap((event) => candidatesFromKnownObject(row, event.raw_payload, "raw_event_webhook_inbox", `speed_webhook_events:${event.id}`))
}

async function candidatesFromReconciliationRecords(row: OperationRow): Promise<Candidate[]> {
  const { data, error } = await db
    .from("wallet_operation_events")
    .select("*")
    .eq("wallet_operation_id", row.id)
    .order("created_at", { ascending: true })
    .limit(50)
  if (error) return []
  return ((data || []) as Array<Record<string, unknown>>)
    .flatMap((event) => candidatesFromKnownObject(row, event.raw_payload, "reconciliation_record", `wallet_operation_events:${event.id}`))
}

async function candidateFromSpeedApi(row: OperationRow): Promise<Candidate | null> {
  if (!includeSpeedApi) return null
  const providerReference = String(row.provider_reference || row.provider_transaction_id || "").trim()
  const speedAccountId = String(row.provider_account_id || row.raw_provider_status?.providerAccountId || "").trim()
  if (!providerReference || !speedAccountId) return null
  const send = await getConnectedAccountSendStatus({
    merchantId: row.merchant_id,
    speedAccountId,
    providerSendId: providerReference,
  })
  return candidateFromDestination({
    row,
    destination: send.withdraw_request,
    network: send.withdraw_method,
    providerReference: send.id,
    source: "speed_api_lookup",
    evidence: "speed:/send/{id}",
  })
}

async function candidateFromSavedDestination(row: OperationRow): Promise<Candidate | null> {
  const destinationId = String(row.destination_id || "").trim()
  if (!destinationId) return null
  const { data, error } = await db
    .from("merchant_withdrawal_destinations")
    .select("*")
    .eq("merchant_id", row.merchant_id)
    .eq("id", destinationId)
    .maybeSingle()
  if (error || !data) return null
  const destination = data as Record<string, unknown>
  if (String(destination.rail || "") !== "bitcoin") return null
  return candidateFromDestination({
    row,
    destination: destination.destination_address,
    label: destination.label,
    network: destination.method,
    providerReference: row.provider_reference || row.provider_transaction_id,
    source: "saved_destination",
    evidence: `merchant_withdrawal_destinations:${destinationId}`,
  })
}

async function recover(row: OperationRow): Promise<{ candidate: Candidate | null; verified: ReturnType<typeof verifyCandidate> | null; requiredSpeedLookup: boolean; reason?: string }> {
  const isBitcoin = String(row.provider || "").toLowerCase() === "speed"
    || String(row.asset || "").toUpperCase() === "SATS"
    || String(row.network || "").toLowerCase().startsWith("bitcoin")
    || Boolean(row.provider_reference || row.provider_transaction_id)
  if (!isBitcoin) return { candidate: null, verified: null, requiredSpeedLookup: false, reason: "not_bitcoin_withdrawal" }
  if (row.destination_address) return { candidate: null, verified: null, requiredSpeedLookup: false, reason: "destination_already_present" }

  const priorityCandidates = [
    ...candidatesFromKnownObject(row, row.destination_snapshot, "canonical_metadata", "merchant_wallet_operations.destination_snapshot"),
    ...candidatesFromKnownObject(row, row.raw_provider_status, "provider_response_payload", "merchant_wallet_operations.raw_provider_status"),
  ]
  for (const candidate of priorityCandidates) {
    const verified = verifyCandidate(row, candidate)
    if (verified.ok) return { candidate: verified.candidate, verified, requiredSpeedLookup: false }
  }

  for (const candidate of await candidatesFromWebhookInbox(row)) {
    const verified = verifyCandidate(row, candidate)
    if (verified.ok) return { candidate: verified.candidate, verified, requiredSpeedLookup: false }
  }

  for (const candidate of await candidatesFromReconciliationRecords(row)) {
    const verified = verifyCandidate(row, candidate)
    if (verified.ok) return { candidate: verified.candidate, verified, requiredSpeedLookup: false }
  }

  const requiredSpeedLookup = Boolean(row.provider_reference || row.provider_transaction_id)
  if (requiredSpeedLookup) {
    try {
      const speedCandidate = await candidateFromSpeedApi(row)
      if (speedCandidate) {
        const verified = verifyCandidate(row, speedCandidate)
        if (verified.ok) return { candidate: verified.candidate, verified, requiredSpeedLookup }
        return { candidate: speedCandidate, verified, requiredSpeedLookup, reason: verified.reason }
      }
    } catch (error) {
      return {
        candidate: null,
        verified: null,
        requiredSpeedLookup,
        reason: `speed_api_lookup_failed:${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  const savedCandidate = await candidateFromSavedDestination(row)
  if (savedCandidate) {
    const verified = verifyCandidate(row, savedCandidate)
    if (verified.ok) return { candidate: verified.candidate, verified, requiredSpeedLookup }
    return { candidate: savedCandidate, verified, requiredSpeedLookup, reason: verified.reason }
  }

  return { candidate: null, verified: null, requiredSpeedLookup, reason: requiredSpeedLookup ? "no_verified_provider_destination" : "no_authoritative_destination_evidence" }
}

/**
 * Commits the destination fields ONLY. Never touches status, amounts, fees,
 * timestamps, provider references, balances or network. Re-asserts the
 * null guard so a concurrent writer can never be overwritten.
 */
async function applyDestinationUpdate(row: OperationRow, candidate: Candidate): Promise<boolean> {
  const { data, error } = await db
    .from("merchant_wallet_operations")
    .update({
      destination_address: candidate.destination,
      destination_label: candidate.label || null,
    })
    .eq("id", row.id)
    .eq("merchant_id", row.merchant_id)
    .is("destination_address", null)
    .select("id")
    .maybeSingle()
  if (error) throw new Error(`operation_update_failed:${error.message}`)
  return Boolean(data)
}

async function hasExistingAuditEvent(row: OperationRow): Promise<boolean> {
  const { data, error } = await db
    .from("merchant_audit_events")
    .select("id")
    .eq("merchant_id", row.merchant_id)
    .eq("event_type", AUDIT_EVENT_TYPE)
    .eq("metadata->>operation_id", row.id)
    .limit(1)
  if (error) throw new Error(`audit_duplicate_check_failed:${error.message}`)
  return (data || []).length > 0
}

function buildAuditMetadata(input: {
  row: OperationRow
  candidate: Candidate
  masked: string
  destination: string
  destinationLabelRecovered: boolean
  backfillRunId: string | null
  backfillTimestampValue: string | null
  backfillTimestampSource: "run_clock" | "operation_updated_at" | "unknown"
  auditMode: "inline" | "retroactive"
}): Record<string, unknown> {
  const { row, candidate } = input
  return {
    operation_id: row.id,
    merchant_id: row.merchant_id,
    provider_reference: row.provider_reference || row.provider_transaction_id || null,
    recovery_source: candidate.source,
    evidence: candidate.evidence,
    masked_verification_result: input.masked,
    // Redacted only — the full destination must never enter an audit payload.
    destination_redacted: redactDestination(input.destination),
    destination_label_recovered: input.destinationLabelRecovered,
    network: candidate.network,
    backfill_run_id: input.backfillRunId,
    backfill_timestamp: input.backfillTimestampValue,
    backfill_timestamp_source: input.backfillTimestampSource,
    audit_run_id: runId,
    audit_written_at: backfillTimestamp,
    audit_mode: input.auditMode,
  }
}

/** Writes audit evidence. Separate statement from the destination update. */
async function writeAuditEvent(row: OperationRow, metadata: Record<string, unknown>): Promise<void> {
  await insertMerchantAuditEventStrict({
    merchantId: row.merchant_id,
    eventType: AUDIT_EVENT_TYPE,
    metadata,
  })
}

/**
 * Re-derives which evidence source produced an ALREADY-STORED destination.
 * Read-only: used by the retroactive audit pass, which must never write to
 * destination fields.
 */
async function collectCandidatesInPriorityOrder(row: OperationRow): Promise<Candidate[]> {
  const candidates: Candidate[] = [
    ...candidatesFromKnownObject(row, row.destination_snapshot, "canonical_metadata", "merchant_wallet_operations.destination_snapshot"),
    ...candidatesFromKnownObject(row, row.raw_provider_status, "provider_response_payload", "merchant_wallet_operations.raw_provider_status"),
    ...(await candidatesFromWebhookInbox(row)),
    ...(await candidatesFromReconciliationRecords(row)),
  ]
  if (row.provider_reference || row.provider_transaction_id) {
    try {
      const speedCandidate = await candidateFromSpeedApi(row)
      if (speedCandidate) candidates.push(speedCandidate)
    } catch {
      // Provider lookup is best-effort when re-deriving a known destination.
    }
  }
  const savedCandidate = await candidateFromSavedDestination(row)
  if (savedCandidate) candidates.push(savedCandidate)
  return candidates
}

type StoredDestinationCheck =
  | { ok: true; masked: string; destination: string }
  | { ok: false; reason: string }

/**
 * Local-only re-verification of a row that already carries a destination:
 * destination present, ids intact, and remasks EXACTLY to destination_summary
 * under the production maskDestination(). Performs no network calls and never
 * writes.
 */
function verifyStoredDestination(row: OperationRow): StoredDestinationCheck {
  const destination = String(row.destination_address || "").trim()
  if (!destination) return { ok: false, reason: "destination_address_missing" }
  if (!row.id || !row.merchant_id) return { ok: false, reason: "operation_or_merchant_id_missing" }
  const summary = String(row.destination_summary || "").trim()
  if (!summary) return { ok: false, reason: "missing_destination_summary" }
  const classified = classifyBitcoinWithdrawalDestination(destination)
  if (!classified.valid) return { ok: false, reason: "stored_destination_invalid" }
  const masked = maskDestination(destination)
  if (masked !== summary) return { ok: false, reason: "masked_summary_mismatch" }
  return { ok: true, masked, destination: classified.normalized }
}

/**
 * Re-derives the evidence source for an already-stored destination, requiring
 * the provider reference to agree where both sides carry one. Expensive
 * (may hit the provider), so it runs only for rows actually being audited.
 */
async function deriveRecoverySource(row: OperationRow, destination: string): Promise<Candidate | null> {
  const rowReference = String(row.provider_reference || row.provider_transaction_id || "").trim()
  for (const candidate of await collectCandidatesInPriorityOrder(row)) {
    if (candidate.destination !== destination) continue
    const candidateReference = String(candidate.providerReference || "").trim()
    if (rowReference && candidateReference && rowReference !== candidateReference) continue
    return candidate
  }
  return null
}

async function runRetroactiveAuditPass(): Promise<void> {
  const auditSummary: AuditSummary = {
    mode: apply ? "apply" : "dry-run",
    pass: "retroactive-audit",
    auditTable: "merchant_audit_events",
    auditEventType: AUDIT_EVENT_TYPE,
    runId,
    originalRunId,
    destinationRowsExamined: 0,
    remaskVerified: 0,
    remaskFailed: 0,
    recoverySourceUnknown: 0,
    auditInserted: 0,
    auditSkippedDuplicate: 0,
    auditFailed: 0,
    unresolvedRowsUntouched: 0,
    bySource: {},
  }
  const auditExamples: RowResult[] = []

  const rows = await loadHistoricalRows("populated-destination")
  for (const row of rows) {
    auditSummary.destinationRowsExamined += 1
    const baseExample = {
      operationId: row.id,
      providerReference: row.provider_reference || row.provider_transaction_id || null,
      network: row.network || null,
    }
    try {
      // 1. Local remask verification first — cheap, and required before any
      //    audit claim is made about this row.
      const verification = verifyStoredDestination(row)
      if (!verification.ok) {
        auditSummary.remaskFailed += 1
        if (auditExamples.length < 20) {
          auditExamples.push({ ...baseExample, source: null, status: "audit_failed", reason: verification.reason })
        }
        continue
      }
      auditSummary.remaskVerified += 1

      // 2. Duplicate check BEFORE source re-derivation: an already-audited row
      //    needs no provider round-trip, and must never be reported as failed
      //    merely because its source is no longer re-derivable.
      if (await hasExistingAuditEvent(row)) {
        auditSummary.auditSkippedDuplicate += 1
        if (auditExamples.length < 20) {
          auditExamples.push({
            ...baseExample,
            source: null,
            status: "audit_duplicate",
            reason: "audit_event_already_present",
            destinationRedacted: redactDestination(verification.destination),
            maskedVerificationResult: verification.masked,
          })
        }
        continue
      }

      // 3. Only now re-derive the recovery source (may hit the provider).
      const candidate = await deriveRecoverySource(row, verification.destination)
      if (!candidate) {
        auditSummary.recoverySourceUnknown += 1
        if (auditExamples.length < 20) {
          auditExamples.push({ ...baseExample, source: null, status: "audit_failed", reason: "recovery_source_unknown" })
        }
        continue
      }
      auditSummary.bySource[candidate.source] = (auditSummary.bySource[candidate.source] || 0) + 1

      if (!apply) {
        if (auditExamples.length < 20) {
          auditExamples.push({
            ...baseExample,
            source: candidate.source,
            status: "verified",
            reason: "dry_run_audit_pending",
            destinationRedacted: redactDestination(verification.destination),
            destinationLabelRecovered: Boolean(row.destination_label),
            maskedVerificationResult: verification.masked,
          })
        }
        continue
      }

      await writeAuditEvent(row, buildAuditMetadata({
        row,
        candidate,
        masked: verification.masked,
        destination: verification.destination,
        destinationLabelRecovered: Boolean(row.destination_label),
        backfillRunId: originalRunId,
        // The destination UPDATE bumped updated_at via the table trigger, so it
        // is the true commit time of the backfill for retroactively audited rows.
        backfillTimestampValue: row.updated_at || null,
        backfillTimestampSource: row.updated_at ? "operation_updated_at" : "unknown",
        auditMode: "retroactive",
      }))
      auditSummary.auditInserted += 1
      if (auditExamples.length < 20) {
        auditExamples.push({
          ...baseExample,
          source: candidate.source,
          status: "audit_inserted",
          reason: "retroactive_audit_written",
          destinationRedacted: redactDestination(verification.destination),
          destinationLabelRecovered: Boolean(row.destination_label),
          maskedVerificationResult: verification.masked,
        })
      }
    } catch (error) {
      auditSummary.auditFailed += 1
      if (auditExamples.length < 20) {
        auditExamples.push({
          ...baseExample,
          source: null,
          status: "audit_failed",
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  auditSummary.unresolvedRowsUntouched = await countUnresolvedWithdrawals()

  console.log(JSON.stringify({
    summary: auditSummary,
    examples: auditExamples,
    notes: [
      "Audit-only pass: destination_address and destination_label are never written in this mode.",
      "Audit evidence is written to merchant_audit_events; wallet_operation_events cannot hold merchant_wallet_operations ids.",
      "Rows are audited only after the stored destination remasks to exactly destination_summary and a recovery source is re-derived.",
      "Duplicate audit records are detected on (merchant_id, event_type, metadata->>operation_id) and skipped.",
      "Unresolved rows (destination_address still null) are counted but never modified.",
    ],
  }, null, 2))
}

async function runDestinationBackfillPass(): Promise<void> {
  const summary: Summary = {
    mode: apply ? "apply" : "dry-run",
    pass: "destination-backfill",
    auditTable: "merchant_audit_events",
    auditEventType: AUDIT_EVENT_TYPE,
    runId,
    scanned: 0,
    recovered: 0,
    localRecoverable: 0,
    requiringSpeedApiLookup: 0,
    speedApiLookupsAttempted: 0,
    verified: 0,
    updated: 0,
    skipped: 0,
    unresolved: 0,
    failed: 0,
    auditInserted: 0,
    auditSkippedDuplicate: 0,
    auditFailed: 0,
    bySource: {},
  }
  const examples: RowResult[] = []

  const rows = await loadHistoricalRows()
  for (const row of rows) {
    summary.scanned += 1
    try {
      const result = await recover(row)
      if (result.requiredSpeedLookup) summary.requiringSpeedApiLookup += 1
      if (result.requiredSpeedLookup && includeSpeedApi) summary.speedApiLookupsAttempted += 1
      if (!result.candidate || !result.verified?.ok) {
        const status = result.reason === "not_bitcoin_withdrawal" || result.reason === "destination_already_present" ? "skipped" : "unresolved"
        summary[status] += 1
        if (examples.length < 10) {
          examples.push({
            operationId: row.id,
            providerReference: row.provider_reference || row.provider_transaction_id || null,
            source: result.candidate?.source || null,
            status,
            reason: result.reason || (result.verified && !result.verified.ok ? result.verified.reason : "unresolved"),
            network: row.network || null,
            destinationRedacted: null,
            destinationLabelRecovered: false,
            maskedVerificationResult: null,
          })
        }
        continue
      }

      summary.recovered += 1
      summary.verified += 1
      summary.bySource[result.verified.candidate.source] = (summary.bySource[result.verified.candidate.source] || 0) + 1
      if (result.verified.candidate.source !== "speed_api_lookup") summary.localRecoverable += 1
      let status: RowResult["status"] = "verified"
      let reason = apply ? "verified_pending_update" : "dry_run_verified"

      if (apply) {
        const updated = await applyDestinationUpdate(row, result.verified.candidate)
        if (!updated) {
          summary.skipped += 1
          status = "skipped"
          reason = "destination_already_present_on_apply"
        } else {
          // The destination write has COMMITTED at this point. supabase-js
          // cannot span a transaction across tables, so the audit insert below
          // is a separate statement whose failure must never be reported as a
          // failed destination update.
          summary.updated += 1
          status = "updated"
          reason = "updated_and_audited"
          try {
            if (await hasExistingAuditEvent(row)) {
              summary.auditSkippedDuplicate += 1
              reason = "updated_audit_already_present"
            } else {
              await writeAuditEvent(row, buildAuditMetadata({
                row,
                candidate: result.verified.candidate,
                masked: result.verified.masked,
                destination: result.verified.candidate.destination,
                destinationLabelRecovered: Boolean(result.verified.candidate.label),
                backfillRunId: runId,
                backfillTimestampValue: backfillTimestamp,
                backfillTimestampSource: "run_clock",
                auditMode: "inline",
              }))
              summary.auditInserted += 1
            }
          } catch (auditError) {
            summary.auditFailed += 1
            status = "updated_audit_failed"
            reason = `destination_committed_audit_write_failed:${auditError instanceof Error ? auditError.message : String(auditError)}`
          }
        }
      }

      if (examples.length < 10) {
        examples.push({
          operationId: row.id,
          providerReference: row.provider_reference || row.provider_transaction_id || null,
          source: result.verified.candidate.source,
          status,
          reason,
          network: result.verified.candidate.network,
          destinationRedacted: redactDestination(result.verified.candidate.destination),
          destinationLabelRecovered: Boolean(result.verified.candidate.label),
          maskedVerificationResult: result.verified.masked,
        })
      }
    } catch (error) {
      summary.failed += 1
      if (examples.length < 10) {
        examples.push({
          operationId: row.id,
          providerReference: row.provider_reference || row.provider_transaction_id || null,
          source: null,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
          network: row.network || null,
        })
      }
    }
  }

  console.log(JSON.stringify({
    summary,
    examples,
    notes: [
      "Dry-run is the default and performs no database writes.",
      "No destination is inferred from destination_summary; recovered destinations must normalize and remask to the exact stored summary.",
      "Apply mode updates only rows whose destination_address is still null and writes audit evidence to merchant_audit_events.",
      "`failed` counts destination-update failures only. Audit-write failures are reported separately as `auditFailed` and leave the committed destination intact; rerun with --audit-only --apply to repair them.",
      includeSpeedApi ? "Speed API lookup was enabled for rows with provider references." : "Speed API lookup was disabled by --no-speed-api.",
    ],
  }, null, 2))
}

if (auditOnly) {
  await runRetroactiveAuditPass()
} else {
  await runDestinationBackfillPass()
}
