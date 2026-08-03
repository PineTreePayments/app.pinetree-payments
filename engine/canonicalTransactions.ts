import {
  canonicalAttemptSettledAt,
  loadAllCanonicalTransactions,
  loadCanonicalTransactionById,
  loadCanonicalTransactionPage,
  orderRawCanonicalTransactionPayment,
  type CanonicalTransactionPageInput,
  type CanonicalTransactionReadFilters,
  type RawCanonicalPaymentEvent,
  type RawCanonicalTransactionAttempt,
  type RawCanonicalTransactionPayment,
} from "@/database/canonicalTransactions"
import { normalizeStoredPaymentStatus } from "@/lib/utils/canonicalPaymentStatus"
import { getPaymentStatusLabel } from "@/lib/utils/paymentStatus"
import {
  resolveCanonicalPaymentSource,
  type CanonicalPaymentSource,
  type CanonicalPaymentSourceKey,
} from "@/lib/utils/paymentSource"

export type CanonicalPaymentLifecycleStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED"
  | "INCOMPLETE"

export type CanonicalTransactionAdjustmentStatus = "REFUNDED" | "DISPUTED" | null

export type CanonicalTransactionRail =
  | "Bitcoin Lightning"
  | "Base"
  | "Solana"
  | "Ethereum"
  | "Card"
  | "Cash"
  | "Crypto"
  | "Other"

export type CanonicalTransactionDiagnostic = {
  code: "INVALID_PAYMENT_STATUS"
  message: string
  paymentId: string
  rawValue: string | null
}

/**
 * How a payment originated, decided once here on the canonical record.
 *
 * The vocabulary itself lives in `lib/utils/paymentSource` so the engine and
 * Admin presentation share one mapping. Surfaces render `paymentSource.label`
 * verbatim — no UI may re-derive "Terminal" vs "Online Checkout" from
 * `channel`, `source`, or metadata.
 */
export type { CanonicalPaymentSource, CanonicalPaymentSourceKey }
export { resolveCanonicalPaymentSource }

export type CanonicalLifecycleEvent = {
  id: string
  type: string
  status: string
  occurredAt: string | null
  providerEvent: string | null
  isDuplicate: boolean
}

export type CanonicalTransactionAttempt = {
  id: string
  status: string | null
  provider: string | null
  providerReference: string | null
  network: string | null
  channel: string | null
  totalAmountMinor: number | null
  subtotalAmountMinor: number | null
  feeAmountMinor: number | null
  createdAt: string | null
  updatedAt: string | null
  isAdjustment: boolean
}

export type CanonicalTransaction = {
  paymentId: string
  attemptId: string | null
  merchantId: string
  providerReference: string | null
  transactionHash: string | null
  rail: CanonicalTransactionRail
  network: string
  asset: string
  currency: string
  amountMinor: number
  displayAmount: string
  canonicalStatus: CanonicalPaymentLifecycleStatus
  displayStatus: string
  occurredAt: string
  createdAt: string
  updatedAt: string | null
  confirmedAt: string | null
  source: string
  paymentSource: CanonicalPaymentSource

  provider: string
  channel: string | null
  paymentMode: "live" | "test"
  adjustmentStatus: CanonicalTransactionAdjustmentStatus
  adjustedAt: string | null
  merchantAmountMinor: number | null
  grossAmountMinor: number | null
  feeAmountMinor: number | null
  subtotalAmountMinor: number | null
  transactionAmountMinor: number | null
  metadata: Record<string, unknown>
  lifecycleEvents: CanonicalLifecycleEvent[]
  attempts: CanonicalTransactionAttempt[]
  diagnostics: CanonicalTransactionDiagnostic[]
  raw: {
    paymentStatus: string | null
    paymentProvider: string | null
    transactionStatus: string | null
    transactionProvider: string | null
    network: string | null
    channel: string | null
    currency: string | null
    merchantAmount: number | string | null
    grossAmount: number | string | null
    pinetreeFee: number | string | null
    transactionTotalAmount: number | string | null
    transactionSubtotalAmount: number | string | null
    transactionPlatformFee: number | string | null
  }
}

export type CanonicalTransactionPage = {
  rows: CanonicalTransaction[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

const KNOWN_LIFECYCLE_STATUSES = new Set<CanonicalPaymentLifecycleStatus>([
  "CREATED",
  "PENDING",
  "PROCESSING",
  "CONFIRMED",
  "FAILED",
  "EXPIRED",
  "CANCELED",
  "INCOMPLETE",
])

const CARD_PROVIDERS = new Set(["stripe", "shift4", "fluidpay"])
const LIGHTNING_ALIASES = new Set([
  "bitcoinlightning",
  "btclightning",
  "lightningbtc",
  "lightning",
  "lightningspeed",
  "lightningnwc",
  "speed",
  "tryspeed",
  "nwc",
])

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

function key(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}

function dateEpoch(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function compareAttemptsNewestFirst(
  left: RawCanonicalTransactionAttempt,
  right: RawCanonicalTransactionAttempt
) {
  const byCreated = dateEpoch(right.created_at) - dateEpoch(left.created_at)
  if (byCreated) return byCreated
  const bySettled =
    dateEpoch(canonicalAttemptSettledAt(right)) - dateEpoch(canonicalAttemptSettledAt(left))
  if (bySettled) return bySettled
  return String(right.id || "").localeCompare(String(left.id || ""))
}

function compareEventsOldestFirst(
  left: RawCanonicalPaymentEvent,
  right: RawCanonicalPaymentEvent
) {
  const byCreated = dateEpoch(left.created_at) - dateEpoch(right.created_at)
  if (byCreated) return byCreated
  return String(left.id || "").localeCompare(String(right.id || ""))
}

function upperStatus(value: unknown): string | null {
  return text(value)?.toUpperCase() || null
}

function isAdjustmentAttempt(attempt: RawCanonicalTransactionAttempt): boolean {
  const status = upperStatus(attempt.status)
  return status === "REFUNDED" || status === "DISPUTED"
}

/**
 * Newest non-adjustment transaction wins, with timestamp then id tie-breakers.
 * If a legacy row was overwritten to REFUNDED/DISPUTED and is the only row,
 * it still supplies attempt metadata while its status remains an adjustment.
 */
export function selectCanonicalTransactionAttempt(
  attempts: readonly RawCanonicalTransactionAttempt[] | null | undefined
): RawCanonicalTransactionAttempt | null {
  const ordered = Array.isArray(attempts)
    ? [...attempts].sort(compareAttemptsNewestFirst)
    : []
  return ordered.find((attempt) => !isAdjustmentAttempt(attempt)) || ordered[0] || null
}

export function normalizeCanonicalPaymentStatus(
  rawStatus: unknown,
  paymentId = ""
): {
  canonicalStatus: CanonicalPaymentLifecycleStatus
  displayStatus: string
  diagnostics: CanonicalTransactionDiagnostic[]
} {
  const raw = upperStatus(rawStatus)
  const normalized = normalizeStoredPaymentStatus(raw)
  if (KNOWN_LIFECYCLE_STATUSES.has(normalized as CanonicalPaymentLifecycleStatus)) {
    const canonicalStatus = normalized as CanonicalPaymentLifecycleStatus
    return { canonicalStatus, displayStatus: getPaymentStatusLabel(canonicalStatus), diagnostics: [] }
  }
  throw new Error(`Payment ${paymentId || "(missing id)"} has invalid lifecycle status ${raw || "(empty)"}`)
}

function decimalMoneyToMinor(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null
}

function storedMinor(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric) : null
}

function normalizeAssetCandidate(value: unknown): string | null {
  const raw = String(value ?? "").trim().toUpperCase()
  if (!raw) return null
  if (["USDC", "USD", "ETH", "SOL", "BTC"].includes(raw)) return raw
  if (["BASE-USDC", "USDC-BASE", "SOL-USDC", "USDC-SOL"].includes(raw)) return "USDC"
  if (["ETH-BASE", "BASE-ETH"].includes(raw)) return "ETH"
  if (["BTC-LIGHTNING", "LIGHTNING-BTC", "SATS", "SAT"].includes(raw)) return "BTC"
  if (["SOL-PINETREE", "SOLANA-SOL"].includes(raw)) return "SOL"
  return null
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function resolveRail(
  rawNetwork: string | null,
  rawProvider: string | null
): { rail: CanonicalTransactionRail; network: string } {
  const networkKey = key(rawNetwork)
  const providerKey = key(rawProvider)
  if (LIGHTNING_ALIASES.has(networkKey) || LIGHTNING_ALIASES.has(providerKey)) {
    return { rail: "Bitcoin Lightning", network: "Bitcoin Lightning" }
  }
  if (providerKey === "cash" || networkKey === "cash") return { rail: "Cash", network: "Cash" }
  if (CARD_PROVIDERS.has(providerKey) || CARD_PROVIDERS.has(networkKey)) {
    return { rail: "Card", network: "Card" }
  }
  if (networkKey === "base" || providerKey === "base") return { rail: "Base", network: "Base" }
  if (networkKey === "solana" || providerKey === "solana") return { rail: "Solana", network: "Solana" }
  if (networkKey === "ethereum" || providerKey === "ethereum") {
    return { rail: "Ethereum", network: "Ethereum" }
  }
  if (rawNetwork) return { rail: "Crypto", network: rawNetwork }
  return { rail: "Other", network: "Unknown" }
}

function resolveAsset(
  rail: CanonicalTransactionRail,
  currency: string,
  metadata: Record<string, unknown>
): string {
  if (rail === "Bitcoin Lightning") return "BTC"
  if (rail === "Cash" || rail === "Card") return "USD"

  const split = object(metadata.split)
  const candidates = [
    metadata.selectedAsset,
    metadata.asset,
    split?.asset,
    split?.nativeSymbol,
    metadata.nativeSymbol,
    currency,
  ]
  for (const candidate of candidates) {
    const normalized = normalizeAssetCandidate(candidate)
    if (normalized && normalized !== "USD") return normalized
  }

  // Native-asset legacy payments predate selectedAsset metadata.
  if (rail === "Base" || rail === "Ethereum") return "ETH"
  if (rail === "Solana") return "SOL"
  return normalizeAssetCandidate(currency) || "UNSPECIFIED"
}

function resolveCurrency(rail: CanonicalTransactionRail, rawCurrency: unknown): string {
  if (rail === "Cash" || rail === "Card") return "USD"
  return String(rawCurrency || "USD").trim().toUpperCase() || "USD"
}

function formatDisplayAmount(amountMinor: number, currency: string): string {
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amountMinor / 100)
    } catch {
      // Fall through to a stable non-ISO representation.
    }
  }
  return `${(amountMinor / 100).toFixed(2)} ${currency}`.trim()
}

function normalizeEventStatus(type: string): string {
  const suffix = type.split(".").pop()?.trim().toUpperCase() || "CREATED"
  return suffix === "CANCELLED" ? "CANCELED" : suffix
}

function projectLifecycleEvents(
  events: readonly RawCanonicalPaymentEvent[] | null | undefined
): CanonicalLifecycleEvent[] {
  const ordered = Array.isArray(events) ? [...events].sort(compareEventsOldestFirst) : []
  const providerEvents = new Set<string>()
  return ordered.map((event) => {
    const type = String(event.event_type || "payment.created").trim().toLowerCase()
    const providerEvent = text(event.provider_event)
    const duplicateKey = providerEvent ? providerEvent.toLowerCase() : ""
    const isDuplicate = Boolean(duplicateKey && providerEvents.has(duplicateKey))
    if (duplicateKey) providerEvents.add(duplicateKey)
    return {
      id: String(event.id || ""),
      type,
      status: normalizeEventStatus(type),
      occurredAt: text(event.created_at),
      providerEvent,
      isDuplicate,
    }
  })
}

function toAttempt(attempt: RawCanonicalTransactionAttempt): CanonicalTransactionAttempt {
  return {
    id: String(attempt.id || ""),
    status: upperStatus(attempt.status),
    provider: text(attempt.provider),
    providerReference: text(attempt.provider_transaction_id),
    network: text(attempt.network),
    channel: text(attempt.channel)?.toLowerCase() || null,
    totalAmountMinor: storedMinor(attempt.total_amount),
    subtotalAmountMinor: storedMinor(attempt.subtotal_amount),
    feeAmountMinor: storedMinor(attempt.platform_fee),
    createdAt: text(attempt.created_at),
    updatedAt: canonicalAttemptSettledAt(attempt),
    isAdjustment: isAdjustmentAttempt(attempt),
  }
}

function adjustmentEvidence(
  attempts: readonly RawCanonicalTransactionAttempt[],
  events: readonly CanonicalLifecycleEvent[]
): { status: CanonicalTransactionAdjustmentStatus; occurredAt: string | null } {
  const evidence: Array<{
    status: Exclude<CanonicalTransactionAdjustmentStatus, null>
    occurredAt: string | null
    id: string
  }> = []

  for (const attempt of attempts) {
    const status = upperStatus(attempt.status)
    if (status === "REFUNDED" || status === "DISPUTED") {
      evidence.push({
        status,
        occurredAt: canonicalAttemptSettledAt(attempt) || text(attempt.created_at),
        id: attempt.id,
      })
    }
  }
  for (const event of events) {
    if (event.status === "REFUNDED" || event.status === "DISPUTED") {
      evidence.push({ status: event.status, occurredAt: event.occurredAt, id: event.id })
    }
  }

  evidence.sort((left, right) => {
    const byDate = dateEpoch(right.occurredAt) - dateEpoch(left.occurredAt)
    return byDate || right.id.localeCompare(left.id)
  })
  return evidence[0]
    ? { status: evidence[0].status, occurredAt: evidence[0].occurredAt }
    : { status: null, occurredAt: null }
}

function confirmedAt(
  canonicalStatus: CanonicalPaymentLifecycleStatus,
  events: readonly CanonicalLifecycleEvent[],
  row: RawCanonicalTransactionPayment
): string | null {
  if (canonicalStatus !== "CONFIRMED") return null
  const confirmation = events.find((event) => event.status === "CONFIRMED" && event.occurredAt)
  return confirmation?.occurredAt || text(row.updated_at)
}

function actualTransactionHash(
  rail: CanonicalTransactionRail,
  attempt: RawCanonicalTransactionAttempt | null,
  metadata: Record<string, unknown>
): string | null {
  if (!["Base", "Solana", "Ethereum"].includes(rail)) return null

  // provider_transaction_id belongs to the selected payment attempt. Approval
  // hashes live only in metadata and must never replace it.
  const persistedAttemptHash = text(attempt?.provider_transaction_id)
  if (persistedAttemptHash) return persistedAttemptHash

  const paymentTransaction = object(metadata.paymentTransaction)
  const explicitlyPaymentScoped = [
    metadata.paymentTransactionHash,
    metadata.payment_transaction_hash,
    metadata.paymentTxHash,
    metadata.payment_tx_hash,
    paymentTransaction?.transactionHash,
    paymentTransaction?.txHash,
    paymentTransaction?.hash,
  ]
  for (const candidate of explicitlyPaymentScoped) {
    const hash = text(candidate)
    if (hash) return hash
  }

  // Generic Base metadata has historically held the USDC approval hash, so it
  // is intentionally not a transaction-hash fallback on Base.
  if (rail !== "Base") {
    return text(metadata.transactionHash) || text(metadata.transaction_hash) || text(metadata.txHash)
  }
  return null
}

function readPaymentMode(metadata: Record<string, unknown>): "live" | "test" {
  return metadata.payment_mode === "test" ? "test" : "live"
}


/**
 * Pure canonical projector. The only input to `canonicalStatus` is
 * `row.status` from payments. Event, transaction, provider, timeout, and
 * adjustment statuses are deliberately absent from that decision.
 */
export function projectCanonicalTransaction(
  input: RawCanonicalTransactionPayment
): CanonicalTransaction {
  const row = orderRawCanonicalTransactionPayment(input)
  const paymentId = String(row.id || "")
  const status = normalizeCanonicalPaymentStatus(row.status, paymentId)
  const rawAttempts = Array.isArray(row.transactions)
    ? [...row.transactions].sort(compareAttemptsNewestFirst)
    : []
  const attempt = selectCanonicalTransactionAttempt(rawAttempts)
  const metadata = object(row.metadata) || {}
  const paymentProvider = text(row.provider)
  const transactionProvider = text(attempt?.provider)
  const provider = paymentProvider || transactionProvider || "unknown"
  const rawNetwork = text(row.network) || text(attempt?.network)
  const railAndNetwork = resolveRail(rawNetwork, provider)
  const currency = resolveCurrency(railAndNetwork.rail, row.currency)
  const asset = resolveAsset(railAndNetwork.rail, currency, metadata)
  const merchantAmountMinor = decimalMoneyToMinor(row.merchant_amount)
  const grossAmountMinor = decimalMoneyToMinor(row.gross_amount)
  const feeAmountMinor = decimalMoneyToMinor(row.pinetree_fee)
  const transactionAmountMinor = storedMinor(attempt?.total_amount)
  const subtotalAmountMinor = storedMinor(attempt?.subtotal_amount)
  const amountMinor = grossAmountMinor ?? transactionAmountMinor ?? merchantAmountMinor ?? 0
  const channel = text(attempt?.channel)?.toLowerCase() || text(metadata.channel)?.toLowerCase() || null
  const lifecycleEvents = projectLifecycleEvents(row.payment_events)
  const adjustment = adjustmentEvidence(rawAttempts, lifecycleEvents)
  const providerReference = text(row.provider_reference) || text(attempt?.provider_transaction_id)
  const source = text(metadata.source) || text(metadata.integration) || channel || "payments"

  return {
    paymentId,
    attemptId: text(attempt?.id),
    merchantId: String(row.merchant_id || ""),
    providerReference,
    transactionHash: actualTransactionHash(railAndNetwork.rail, attempt, metadata),
    rail: railAndNetwork.rail,
    network: railAndNetwork.network,
    asset,
    currency,
    amountMinor,
    displayAmount: formatDisplayAmount(amountMinor, currency),
    canonicalStatus: status.canonicalStatus,
    displayStatus: status.displayStatus,
    occurredAt: String(row.created_at || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: text(row.updated_at),
    confirmedAt: confirmedAt(status.canonicalStatus, lifecycleEvents, row),
    source,
    paymentSource: resolveCanonicalPaymentSource(channel),
    provider,
    channel,
    paymentMode: readPaymentMode(metadata),
    adjustmentStatus: adjustment.status,
    adjustedAt: adjustment.occurredAt,
    merchantAmountMinor,
    grossAmountMinor,
    feeAmountMinor,
    subtotalAmountMinor,
    transactionAmountMinor,
    metadata,
    lifecycleEvents,
    attempts: rawAttempts.map(toAttempt),
    diagnostics: status.diagnostics,
    raw: {
      paymentStatus: upperStatus(row.status),
      paymentProvider,
      transactionStatus: upperStatus(attempt?.status),
      transactionProvider,
      network: rawNetwork,
      channel,
      currency: text(row.currency),
      merchantAmount: row.merchant_amount ?? null,
      grossAmount: row.gross_amount ?? null,
      pinetreeFee: row.pinetree_fee ?? null,
      transactionTotalAmount: attempt?.total_amount ?? null,
      transactionSubtotalAmount: attempt?.subtotal_amount ?? null,
      transactionPlatformFee: attempt?.platform_fee ?? null,
    },
  }
}

export function projectCanonicalTransactions(
  rows: readonly RawCanonicalTransactionPayment[]
): CanonicalTransaction[] {
  return rows.map(projectCanonicalTransaction)
}

const CANONICAL_PAGE_SIZE_MAX = 250
const LIGHTNING_NETWORK_FILTER_KEYS = new Set([
  "bitcoinlightning",
  "btclightning",
  "lightningbtc",
  "lightning",
])

function filterValue(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase()
  return normalized && normalized !== "all" ? normalized : null
}

function networkFilterKey(value: unknown): string {
  const normalized = key(value)
  return LIGHTNING_NETWORK_FILTER_KEYS.has(normalized)
    ? "bitcoinlightning"
    : normalized
}

function railFilterKey(value: unknown): string {
  const normalized = networkFilterKey(value)
  return normalized === "bitcoin" ? "bitcoinlightning" : normalized
}

function projectionMode(
  value: CanonicalTransactionReadFilters["mode"]
): "pos" | "online" | null {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized === "pos" || normalized === "online" ? normalized : null
}

/**
 * These fields are derived by the canonical projector, so prefiltering a
 * payment column or arbitrary embedded attempt would change their meaning.
 */
export function hasCanonicalProjectionFilters(
  input: CanonicalTransactionReadFilters
): boolean {
  return Boolean(
    filterValue(input.provider) ||
    filterValue(input.network) ||
    filterValue(input.asset) ||
    filterValue(input.source) ||
    filterValue(input.rail) ||
    filterValue(input.method) ||
    filterValue(input.channel) ||
    text(input.search) ||
    projectionMode(input.mode)
  )
}

/** Apply every derived predicate to the same values returned to consumers. */
export function matchesCanonicalTransactionFilters(
  row: CanonicalTransaction,
  input: CanonicalTransactionReadFilters
): boolean {
  const provider = filterValue(input.provider)
  if (provider && row.provider.trim().toLowerCase() !== provider) return false

  const network = filterValue(input.network)
  if (network && networkFilterKey(row.network) !== networkFilterKey(network)) return false

  const asset = filterValue(input.asset)
  if (asset && row.asset.trim().toLowerCase() !== asset) return false

  const source = filterValue(input.source)
  if (source && row.source.trim().toLowerCase() !== source) return false

  const rail = filterValue(input.rail)
  if (rail && railFilterKey(row.rail) !== railFilterKey(rail)) return false

  const method = filterValue(input.method)
  if (method && railFilterKey(row.rail) !== railFilterKey(method)) return false

  const channel = filterValue(input.channel)
  if (channel && String(row.channel || "").trim().toLowerCase() !== channel) return false

  const mode = projectionMode(input.mode)
  if (mode && String(row.channel || "").trim().toLowerCase() !== mode) return false

  const search = text(input.search)?.toLowerCase()
  if (search) {
    const fields = [
      row.paymentId,
      row.attemptId,
      row.providerReference,
      row.transactionHash,
    ]
    if (!fields.some((value) => String(value || "").toLowerCase().includes(search))) {
      return false
    }
  }

  return true
}

function paymentRootFilters(
  input: CanonicalTransactionReadFilters
): CanonicalTransactionReadFilters {
  const mode = String(input.mode || "all").trim().toLowerCase()
  return {
    scope: input.scope,
    startDate: input.startDate,
    endDate: input.endDate,
    currency: input.currency,
    status: input.status,
    mode: mode === "live" || mode === "test" ? mode : "all",
  }
}

function compareCanonicalNewestFirst(
  left: CanonicalTransaction,
  right: CanonicalTransaction
): number {
  const byDate = dateEpoch(right.occurredAt) - dateEpoch(left.occurredAt)
  if (byDate) return byDate
  if (left.paymentId === right.paymentId) return 0
  return left.paymentId < right.paymentId ? 1 : -1
}

function projectFilteredTransactions(
  rows: readonly RawCanonicalTransactionPayment[],
  input: CanonicalTransactionReadFilters
): CanonicalTransaction[] {
  return projectCanonicalTransactions(rows)
    .filter((row) => matchesCanonicalTransactionFilters(row, input))
    .sort(compareCanonicalNewestFirst)
}

export async function getCanonicalTransactionPage(
  input: CanonicalTransactionPageInput
): Promise<CanonicalTransactionPage> {
  if (!hasCanonicalProjectionFilters(input)) {
    const page = await loadCanonicalTransactionPage({
      ...paymentRootFilters(input),
      page: input.page,
      pageSize: input.pageSize,
    })
    return { ...page, rows: projectCanonicalTransactions(page.rows) }
  }

  const page = Math.max(1, Math.trunc(Number(input.page) || 1))
  const pageSize = Math.min(
    CANONICAL_PAGE_SIZE_MAX,
    Math.max(1, Math.trunc(Number(input.pageSize) || 50))
  )
  const rows = projectFilteredTransactions(
    await loadAllCanonicalTransactions(paymentRootFilters(input)),
    input
  )
  const totalCount = rows.length
  const offset = (page - 1) * pageSize
  return {
    rows: rows.slice(offset, offset + pageSize),
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  }
}

export async function getAllCanonicalTransactions(
  input: CanonicalTransactionReadFilters
): Promise<CanonicalTransaction[]> {
  const rows = await loadAllCanonicalTransactions(paymentRootFilters(input))
  return projectFilteredTransactions(rows, input)
}

export async function getCanonicalTransactionById(
  paymentId: string,
  input: CanonicalTransactionReadFilters
): Promise<CanonicalTransaction | null> {
  const row = await loadCanonicalTransactionById(paymentId, paymentRootFilters(input))
  if (!row) return null
  const projected = projectCanonicalTransaction(row)
  return matchesCanonicalTransactionFilters(projected, input) ? projected : null
}

export type {
  CanonicalTransactionPageInput,
  CanonicalTransactionReadFilters,
  CanonicalTransactionReadMode,
  CanonicalTransactionReadScope,
  RawCanonicalPaymentEvent,
  RawCanonicalTransactionAttempt,
  RawCanonicalTransactionPayment,
} from "@/database/canonicalTransactions"
