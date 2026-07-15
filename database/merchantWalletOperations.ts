import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "merchant_wallet_operations"

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

export type MerchantWalletOperation = {
  id: string
  merchant_id: string
  provider: string
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
  provider_status: string | null
  raw_provider_status: Record<string, unknown> | null
  failure_code: string | null
  failure_reason: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type CreateWalletOperationInput = {
  merchantId: string
  provider?: string
  operationType: WalletOperationType
  direction: WalletOperationDirection
  status?: WalletOperationStatus
  asset: string
  network?: string
  amountBaseUnits: bigint
  feeBaseUnits?: bigint | null
  destinationSummary?: string | null
  idempotencyKey: string
}

export type UpdateWalletOperationInput = {
  status?: WalletOperationStatus
  providerReference?: string | null
  providerStatus?: string | null
  rawProviderStatus?: Record<string, unknown> | null
  txHash?: string | null
  explorerUrl?: string | null
  feeBaseUnits?: bigint | null
  failureCode?: string | null
  failureReason?: string | null
  completedAt?: string | null
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
  const record = {
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
    idempotency_key: input.idempotencyKey,
  }

  const { data, error } = await supabase.from(TABLE).insert(record).select().single()
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
  if (input.status !== undefined) patch.status = input.status
  if (input.providerReference !== undefined) patch.provider_reference = input.providerReference
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

  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("merchant_id", merchantId)
    .eq("id", operationId)
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to update wallet operation: ${error?.message ?? "not found"}`)
  }
  return data as MerchantWalletOperation
}

export type ListWalletOperationsInput = {
  merchantId: string
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

  if (input.type) query = query.eq("operation_type", input.type)
  if (input.status) query = query.eq("status", input.status)
  if (input.cursor) query = query.lt("created_at", input.cursor)

  const { data, error } = await query
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
      status: input.status,
      providerStatus: input.providerStatus ?? null,
      rawProviderStatus: input.rawProviderStatus ?? null,
      completedAt: input.completedAt ?? null,
    })
    return { operation: updated, created: false }
  }

  return createWalletOperation({
    merchantId: input.merchantId,
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
