import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "merchant_wallet_operations"

function isMissingOperationColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST204" || /provider_(account|transaction|secondary|created)/i.test(error.message || "")))
}

function compatibilityProviderStatus(input: {
  rawProviderStatus?: Record<string, unknown> | null
  providerAccountId?: string | null
  providerTransactionId?: string | null
  providerSecondaryReference?: string | null
  providerCreatedAt?: string | null
}): Record<string, unknown> | null {
  const value = {
    ...(input.rawProviderStatus || {}),
    ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}),
    ...(input.providerTransactionId ? { providerTransactionId: input.providerTransactionId } : {}),
    ...(input.providerSecondaryReference ? { providerSecondaryReference: input.providerSecondaryReference } : {}),
    ...(input.providerCreatedAt ? { providerCreatedAt: input.providerCreatedAt } : {}),
  }
  return Object.keys(value).length ? value : null
}

export type WalletOperationType =
  | "PAYMENT"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "WITHDRAWAL"
  | "PAYOUT"
  | "SWAP_IN"
  | "SWAP_OUT"
  | "APPLICATION_FEE"
  | "ADJUSTMENT"

export type WalletOperationStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "EXPIRED"
  | "REQUIRES_ACTION"

export type WalletOperationDirection = "credit" | "debit"
export type WalletOperationSource = "manual" | "saved_address" | "automatic_sweep"

export type MerchantWalletOperation = {
  id: string
  merchant_id: string
  provider: string
  provider_account_id: string | null
  operation_type: WalletOperationType
  direction: WalletOperationDirection
  status: WalletOperationStatus
  asset: string
  network: string
  amount_base_units: string
  fee_base_units: string | null
  destination_summary: string | null
  tx_hash: string | null
  explorer_url: string | null
  provider_reference: string | null
  provider_transaction_id: string | null
  provider_secondary_reference: string | null
  provider_created_at: string | null
  provider_status: string | null
  raw_provider_status: Record<string, unknown> | null
  failure_code: string | null
  failure_reason: string | null
  idempotency_key: string
  source?: WalletOperationSource
  destination_id?: string | null
  destination_snapshot?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  completed_at: string | null
  submitted_at?: string | null
  confirmed_at?: string | null
  failed_at?: string | null
}

export type CreateWalletOperationInput = {
  merchantId: string
  provider?: string
  providerAccountId?: string | null
  operationType: WalletOperationType
  direction: WalletOperationDirection
  status?: WalletOperationStatus
  asset: string
  network?: string
  amountBaseUnits: bigint
  feeBaseUnits?: bigint | null
  destinationSummary?: string | null
  idempotencyKey: string
  providerReference?: string | null
  providerTransactionId?: string | null
  providerSecondaryReference?: string | null
  providerStatus?: string | null
  rawProviderStatus?: Record<string, unknown> | null
  providerCreatedAt?: string | null
}

export type UpdateWalletOperationInput = {
  providerAccountId?: string | null
  status?: WalletOperationStatus
  providerReference?: string | null
  providerTransactionId?: string | null
  providerSecondaryReference?: string | null
  providerCreatedAt?: string | null
  providerStatus?: string | null
  rawProviderStatus?: Record<string, unknown> | null
  txHash?: string | null
  explorerUrl?: string | null
  feeBaseUnits?: bigint | null
  failureCode?: string | null
  failureReason?: string | null
  completedAt?: string | null
  submittedAt?: string | null
  confirmedAt?: string | null
  failedAt?: string | null
}

const TERMINAL_STATUSES: WalletOperationStatus[] = ["COMPLETED", "FAILED", "CANCELED", "EXPIRED"]

export function isTerminalWalletOperationStatus(status: WalletOperationStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * Creates a new wallet operation row, or returns the existing one for the
 * same (merchant_id, idempotency_key) pair unchanged. Callers must always
 * treat the `created` flag as authoritative for whether a provider call
 * should still be attempted.
 */
export async function createWalletOperation(
  input: CreateWalletOperationInput
): Promise<{ operation: MerchantWalletOperation; created: boolean }> {
  const compatibilityStatus = compatibilityProviderStatus(input)
  const baseRecord = {
    merchant_id: input.merchantId,
    provider: input.provider ?? "speed",
    operation_type: input.operationType,
    direction: input.direction,
    status: input.status ?? "CREATED",
    asset: input.asset,
    network: input.network ?? "",
    amount_base_units: input.amountBaseUnits.toString(),
    fee_base_units: input.feeBaseUnits != null ? input.feeBaseUnits.toString() : null,
    destination_summary: input.destinationSummary ?? null,
    provider_reference: input.providerReference ?? null,
    provider_status: input.providerStatus ?? null,
    raw_provider_status: compatibilityStatus,
    idempotency_key: input.idempotencyKey,
  }
  const record = {
    ...baseRecord,
    provider_account_id: input.providerAccountId ?? null,
    provider_transaction_id: input.providerTransactionId ?? null,
    provider_secondary_reference: input.providerSecondaryReference ?? null,
    provider_created_at: input.providerCreatedAt ?? null,
  }

  let { data, error } = await supabase.from(TABLE).insert(record).select().single()
  if (isMissingOperationColumn(error)) {
    ;({ data, error } = await supabase.from(TABLE).insert(baseRecord).select().single())
  }
  if (!error) return { operation: data as MerchantWalletOperation, created: true }

  if (error.code !== "23505") {
    throw new Error(`Failed to create wallet operation: ${error.message}`)
  }

  const existing = await getWalletOperationByIdempotencyKey(input.merchantId, input.idempotencyKey)
  if (!existing) {
    throw new Error("Failed to load existing wallet operation after idempotency conflict")
  }
  return { operation: existing, created: false }
}

export async function getWalletOperationByIdempotencyKey(
  merchantId: string,
  idempotencyKey: string
): Promise<MerchantWalletOperation | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()

  if (error) throw new Error(`Failed to load wallet operation: ${error.message}`)
  return (data ?? null) as MerchantWalletOperation | null
}

export async function getWalletOperationForMerchant(
  merchantId: string,
  operationId: string
): Promise<MerchantWalletOperation | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", operationId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load wallet operation: ${error.message}`)
  return (data ?? null) as MerchantWalletOperation | null
}

export async function updateWalletOperation(
  merchantId: string,
  operationId: string,
  input: UpdateWalletOperationInput
): Promise<MerchantWalletOperation> {
  const patch: Record<string, unknown> = {}
  if (input.providerAccountId !== undefined) patch.provider_account_id = input.providerAccountId
  if (input.status !== undefined) patch.status = input.status
  if (input.providerReference !== undefined) patch.provider_reference = input.providerReference
  if (input.providerTransactionId !== undefined) patch.provider_transaction_id = input.providerTransactionId
  if (input.providerSecondaryReference !== undefined) patch.provider_secondary_reference = input.providerSecondaryReference
  if (input.providerCreatedAt !== undefined) patch.provider_created_at = input.providerCreatedAt
  if (input.providerStatus !== undefined) patch.provider_status = input.providerStatus
  if (input.rawProviderStatus !== undefined) patch.raw_provider_status = input.rawProviderStatus
  if (input.txHash !== undefined) patch.tx_hash = input.txHash
  if (input.explorerUrl !== undefined) patch.explorer_url = input.explorerUrl
  if (input.feeBaseUnits !== undefined) {
    patch.fee_base_units = input.feeBaseUnits != null ? input.feeBaseUnits.toString() : null
  }
  if (input.failureCode !== undefined) patch.failure_code = input.failureCode
  if (input.failureReason !== undefined) patch.failure_reason = input.failureReason
  if (input.completedAt !== undefined) patch.completed_at = input.completedAt
  if (input.submittedAt !== undefined) patch.submitted_at = input.submittedAt
  if (input.confirmedAt !== undefined) patch.confirmed_at = input.confirmedAt
  if (input.failedAt !== undefined) patch.failed_at = input.failedAt

  let { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("merchant_id", merchantId)
    .eq("id", operationId)
    .select()
    .single()

  if (isMissingOperationColumn(error)) {
    const fallbackPatch = { ...patch }
    delete fallbackPatch.provider_account_id
    delete fallbackPatch.provider_transaction_id
    delete fallbackPatch.provider_secondary_reference
    delete fallbackPatch.provider_created_at
    delete fallbackPatch.submitted_at
    delete fallbackPatch.confirmed_at
    delete fallbackPatch.failed_at
    const compatibility = compatibilityProviderStatus(input)
    if (compatibility) fallbackPatch.raw_provider_status = compatibility
    ;({ data, error } = await supabase
      .from(TABLE)
      .update(fallbackPatch)
      .eq("merchant_id", merchantId)
      .eq("id", operationId)
      .select()
      .single())
  }

  if (error || !data) {
    throw new Error(`Failed to update wallet operation: ${error?.message ?? "not found"}`)
  }
  return data as MerchantWalletOperation
}

/**
 * Stamps source/destination_id/destination_snapshot onto an existing
 * operation without going through updateWalletOperation's established
 * input contract - kept separate so the hot Speed-adapter update path never
 * needs to widen for this. Gracefully no-ops the new columns (rather than
 * throwing) if the 20260721_add_canonical_withdrawal_columns.sql migration
 * hasn't been applied yet in a given environment, matching this file's
 * existing isMissingOperationColumn compatibility pattern.
 */
export async function updateWalletOperationCanonicalFields(
  merchantId: string,
  operationId: string,
  input: {
    source: WalletOperationSource
    destinationId?: string | null
    destinationSnapshot?: Record<string, unknown> | null
  }
): Promise<MerchantWalletOperation> {
  const patch: Record<string, unknown> = { source: input.source }
  if (input.destinationId !== undefined) patch.destination_id = input.destinationId
  if (input.destinationSnapshot !== undefined) patch.destination_snapshot = input.destinationSnapshot

  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("merchant_id", merchantId)
    .eq("id", operationId)
    .select()
    .single()

  if (isMissingOperationColumn(error)) {
    const existing = await getWalletOperationForMerchant(merchantId, operationId)
    if (!existing) throw new Error("Failed to stamp canonical wallet operation fields: not found")
    return existing
  }

  if (error || !data) {
    throw new Error(`Failed to stamp canonical wallet operation fields: ${error?.message ?? "not found"}`)
  }
  return data as MerchantWalletOperation
}

/**
 * Sums amount_base_units for non-terminal WITHDRAWAL operations of a given
 * asset - used by the Max-withdrawal calculation so an in-flight Bitcoin
 * withdrawal's amount is never double-counted as still-spendable.
 */
export async function sumPendingWithdrawalOperationBaseUnits(
  merchantId: string,
  asset: string
): Promise<bigint> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("amount_base_units")
    .eq("merchant_id", merchantId)
    .eq("asset", asset)
    .eq("operation_type", "WITHDRAWAL")
    .in("status", ["CREATED", "PENDING", "PROCESSING"])

  if (error) throw new Error(`Failed to sum pending wallet operations: ${error.message}`)
  return (data || []).reduce((total, row) => total + BigInt(row.amount_base_units || "0"), BigInt(0))
}

/**
 * PROCESSING withdrawal operations with a provider reference already
 * recorded - the set the reconciliation cron must poll so a Bitcoin/Speed
 * withdrawal submitted through this table (the actual live execution path,
 * see engine/wallet/walletOperations.ts) is never stuck at PROCESSING
 * forever. Distinct from database/walletWithdrawalRequests.ts's own
 * listProcessingBitcoinWithdrawalsForReconciliation, which queries a
 * different table (wallet_withdrawal_requests) that Bitcoin withdrawals
 * never actually write to.
 */
export async function listProcessingWalletOperationsForReconciliation(
  limit: number,
  merchantId?: string
): Promise<MerchantWalletOperation[]> {
  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("provider", "speed")
    .eq("status", "PROCESSING")
    .eq("operation_type", "WITHDRAWAL")
    .or("provider_reference.not.is.null,provider_transaction_id.not.is.null")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (merchantId) query = query.eq("merchant_id", merchantId)

  let { data, error } = await query
  if (isMissingOperationColumn(error)) {
    query = supabase
      .from(TABLE)
      .select("*")
      .eq("provider", "speed")
      .eq("status", "PROCESSING")
      .eq("operation_type", "WITHDRAWAL")
      .not("provider_reference", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit)
    if (merchantId) query = query.eq("merchant_id", merchantId)
    ;({ data, error } = await query)
  }
  if (error) throw new Error(`Failed to list processing wallet operations for reconciliation: ${error.message}`)
  return (data || []) as MerchantWalletOperation[]
}

export async function listProcessingWalletOperationsMissingProviderReferences(
  limit: number,
  merchantId?: string
): Promise<MerchantWalletOperation[]> {
  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("provider", "speed")
    .eq("status", "PROCESSING")
    .eq("operation_type", "WITHDRAWAL")
    .is("provider_reference", null)
    .is("provider_transaction_id", null)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (merchantId) query = query.eq("merchant_id", merchantId)

  let { data, error } = await query
  if (isMissingOperationColumn(error)) {
    query = supabase
      .from(TABLE)
      .select("*")
      .eq("provider", "speed")
      .eq("status", "PROCESSING")
      .eq("operation_type", "WITHDRAWAL")
      .is("provider_reference", null)
      .order("created_at", { ascending: true })
      .limit(limit)
    if (merchantId) query = query.eq("merchant_id", merchantId)
    ;({ data, error } = await query)
  }
  if (error) throw new Error(`Failed to list processing wallet operations missing provider references: ${error.message}`)
  return (data || []) as MerchantWalletOperation[]
}

/**
 * Recent WITHDRAWAL operations (Bitcoin/Speed) for the Wallet Activity tab -
 * mirrors listRecentWalletWithdrawalsForActivity's shape/purpose in
 * database/walletWithdrawalRequests.ts, since Bitcoin withdrawals live in
 * this separate table and would otherwise never appear in Activity.
 */
export async function listRecentWalletOperationsForActivity(
  merchantId: string,
  limit: number
): Promise<MerchantWalletOperation[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("operation_type", "WITHDRAWAL")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list wallet operations for activity: ${error.message}`)
  return (data || []) as MerchantWalletOperation[]
}

export type ListWalletOperationsInput = {
  merchantId: string
  providerAccountId?: string
  type?: WalletOperationType
  status?: WalletOperationStatus
  cursor?: string | null
  limit?: number
}

export type ListWalletOperationsResult = {
  operations: MerchantWalletOperation[]
  nextCursor: string | null
}

const DEFAULT_ACTIVITY_LIMIT = 25
const MAX_ACTIVITY_LIMIT = 100

/**
 * Cursor-paginated by created_at (descending). Cursor is the created_at ISO
 * timestamp of the last row of the previous page - never loads an unbounded
 * history.
 */
export async function listWalletOperations(
  input: ListWalletOperationsInput
): Promise<ListWalletOperationsResult> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_ACTIVITY_LIMIT, 1), MAX_ACTIVITY_LIMIT)

  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", input.merchantId)
    .order("created_at", { ascending: false })
    .limit(limit + 1)

  if (input.providerAccountId) query = query.eq("provider_account_id", input.providerAccountId)
  if (input.type) query = query.eq("operation_type", input.type)
  if (input.status) query = query.eq("status", input.status)
  if (input.cursor) query = query.lt("created_at", input.cursor)

  let { data, error } = await query
  if (input.providerAccountId && isMissingOperationColumn(error)) {
    let fallback = supabase
      .from(TABLE)
      .select("*")
      .eq("merchant_id", input.merchantId)
      .order("created_at", { ascending: false })
      .limit(MAX_ACTIVITY_LIMIT + 1)
    if (input.type) fallback = fallback.eq("operation_type", input.type)
    if (input.status) fallback = fallback.eq("status", input.status)
    if (input.cursor) fallback = fallback.lt("created_at", input.cursor)
    ;({ data, error } = await fallback)
    if (!error) {
      data = (data ?? []).filter((row: Record<string, unknown>) => {
        const compatibility = row.raw_provider_status as Record<string, unknown> | null
        const account = String(row.provider_account_id || compatibility?.providerAccountId || "")
        return !account || account === input.providerAccountId
      }).slice(0, limit + 1)
    }
  }
  if (error) throw new Error(`Failed to list wallet operations: ${error.message}`)

  const rows = (data ?? []) as MerchantWalletOperation[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return {
    operations: page,
    nextCursor: hasMore ? page[page.length - 1]?.created_at ?? null : null,
  }
}

/**
 * Upserts a wallet operation keyed by a webhook-derived idempotency key
 * (never a merchant-supplied one) - used to normalize incoming Speed
 * connected-account events (e.g. payment.paid) into activity without ever
 * creating a duplicate row for a redelivered webhook.
 */
export async function upsertWalletOperationFromWebhook(input: {
  merchantId: string
  providerAccountId: string
  operationType: WalletOperationType
  direction: WalletOperationDirection
  status: WalletOperationStatus
  asset: string
  network?: string
  amountBaseUnits: bigint
  feeBaseUnits?: bigint | null
  providerReference: string
  providerStatus?: string | null
  rawProviderStatus?: Record<string, unknown> | null
  idempotencyKey: string
  completedAt?: string | null
}): Promise<{ operation: MerchantWalletOperation; created: boolean }> {
  const existing = await getWalletOperationByIdempotencyKey(input.merchantId, input.idempotencyKey)
  if (existing) {
    if (existing.status === input.status) return { operation: existing, created: false }
    const updated = await updateWalletOperation(input.merchantId, existing.id, {
      providerAccountId: input.providerAccountId,
      status: input.status,
      providerStatus: input.providerStatus ?? null,
      rawProviderStatus: input.rawProviderStatus ?? null,
      completedAt: input.completedAt ?? null,
    })
    return { operation: updated, created: false }
  }

  return createWalletOperation({
    merchantId: input.merchantId,
    providerAccountId: input.providerAccountId,
    operationType: input.operationType,
    direction: input.direction,
    status: input.status,
    asset: input.asset,
    network: input.network,
    amountBaseUnits: input.amountBaseUnits,
    feeBaseUnits: input.feeBaseUnits,
    idempotencyKey: input.idempotencyKey,
  }).then(async (result) => {
    if (input.providerReference) {
      const updated = await updateWalletOperation(input.merchantId, result.operation.id, {
        providerAccountId: input.providerAccountId,
        providerReference: input.providerReference,
        providerStatus: input.providerStatus ?? null,
        rawProviderStatus: input.rawProviderStatus ?? null,
        completedAt: input.completedAt ?? null,
      })
      return { operation: updated, created: result.created }
    }
    return result
  })
}

export async function upsertWalletOperationFromProviderActivity(input: {
  merchantId: string
  provider: string
  providerAccountId: string
  providerTransactionId: string
  providerReference?: string | null
  operationType: WalletOperationType
  direction: WalletOperationDirection
  status: WalletOperationStatus
  providerStatus?: string | null
  asset: string
  network?: string | null
  amountBaseUnits: bigint
  feeBaseUnits?: bigint | null
  providerCreatedAt: string
}): Promise<{ operation: MerchantWalletOperation; created: boolean; transactionWasKnown: boolean }> {
  const transactionId = input.providerTransactionId.trim()
  const reference = String(input.providerReference || "").trim()
  if (!/^[A-Za-z0-9_-]+$/.test(transactionId) || !input.providerAccountId.trim()) {
    throw new Error("Provider activity is missing its account-scoped identity")
  }

  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", input.merchantId)
    .eq("provider", input.provider)
    .eq("provider_account_id", input.providerAccountId)

  const safeReference = /^[A-Za-z0-9_-]+$/.test(reference) ? reference : ""
  const filters = [`provider_transaction_id.eq.${transactionId}`]
  if (safeReference) {
    filters.push(`provider_reference.eq.${safeReference}`, `provider_secondary_reference.eq.${safeReference}`)
  }
  query = query.or(filters.join(","))
  let { data, error } = await query.limit(1).maybeSingle()
  if (isMissingOperationColumn(error)) {
    const idempotencyKey = `${input.provider}:${input.providerAccountId}:transaction:${transactionId}`
    const known = await getWalletOperationByIdempotencyKey(input.merchantId, idempotencyKey)
    if (known) {
      data = known
      error = null
    } else if (safeReference) {
      const primary = await supabase
        .from(TABLE)
        .select("*")
        .eq("merchant_id", input.merchantId)
        .eq("provider", input.provider)
        .eq("provider_reference", safeReference)
        .limit(1)
        .maybeSingle()
      data = primary.data
      error = primary.error
      if (!error && !data) {
        const secondary = await supabase
          .from(TABLE)
          .select("*")
          .eq("merchant_id", input.merchantId)
          .eq("provider", input.provider)
          .contains("raw_provider_status", { providerSecondaryReference: safeReference })
          .limit(1)
          .maybeSingle()
        data = secondary.data
        error = secondary.error
      }
    } else {
      data = null
      error = null
    }
  }
  if (error) throw new Error(`Failed to match provider activity: ${error.message}`)

  const existing = (data ?? null) as MerchantWalletOperation | null
  if (existing) {
    const transactionWasKnown = existing.provider_transaction_id === transactionId
      || existing.raw_provider_status?.providerTransactionId === transactionId
    const updated = await updateWalletOperation(input.merchantId, existing.id, {
      providerAccountId: input.providerAccountId,
      status: input.status,
      providerTransactionId: transactionId,
      providerStatus: input.providerStatus ?? null,
      providerCreatedAt: input.providerCreatedAt,
      feeBaseUnits: input.feeBaseUnits ?? null,
      completedAt: input.status === "COMPLETED" ? input.providerCreatedAt : undefined,
    })
    return { operation: updated, created: false, transactionWasKnown }
  }

  const result = await createWalletOperation({
    merchantId: input.merchantId,
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    operationType: input.operationType,
    direction: input.direction,
    status: input.status,
    asset: input.asset,
    network: input.network ?? undefined,
    amountBaseUnits: input.amountBaseUnits,
    feeBaseUnits: input.feeBaseUnits,
    providerReference: reference || null,
    providerTransactionId: transactionId,
    providerStatus: input.providerStatus ?? null,
    providerCreatedAt: input.providerCreatedAt,
    idempotencyKey: `${input.provider}:${input.providerAccountId}:transaction:${transactionId}`,
  })
  return { ...result, transactionWasKnown: false }
}

export async function updateWalletOperationFromProviderEvent(input: {
  merchantId: string
  providerAccountId: string
  providerReference: string
  providerSecondaryReference: string
  status: WalletOperationStatus
  providerStatus: string
  failureReason?: string | null
  txHash?: string | null
  completedAt?: string | null
}): Promise<MerchantWalletOperation | null> {
  const primary = input.providerReference.trim()
  const secondary = input.providerSecondaryReference.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(primary) || !/^[A-Za-z0-9_-]+$/.test(secondary)) return null

  let { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", input.merchantId)
    .eq("provider", "speed")
    .eq("provider_account_id", input.providerAccountId)
    .or(`provider_reference.eq.${primary},provider_secondary_reference.eq.${secondary}`)
    .limit(1)
    .maybeSingle()
  if (isMissingOperationColumn(error)) {
    ;({ data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("merchant_id", input.merchantId)
      .eq("provider", "speed")
      .eq("provider_reference", primary)
      .limit(1)
      .maybeSingle())
  }
  if (error) throw new Error(`Failed to match wallet provider event: ${error.message}`)
  const existing = (data ?? null) as MerchantWalletOperation | null
  if (!existing) return null

  return updateWalletOperation(input.merchantId, existing.id, {
    providerAccountId: input.providerAccountId,
    status: input.status,
    providerSecondaryReference: secondary,
    providerStatus: input.providerStatus,
    rawProviderStatus: input.failureReason ? { failureReason: input.failureReason } : null,
    failureCode: input.status === "FAILED" ? "PROVIDER_REPORTED_FAILURE" : null,
    failureReason: input.failureReason ?? null,
    txHash: input.txHash ?? null,
    completedAt: input.completedAt ?? null,
  })
}
