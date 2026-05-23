import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type WalletOperationStatus =
  | "CREATED"
  | "DRAFT"
  | "VALIDATION_FAILED"
  | "AWAITING_CONFIRMATION"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"

export type WalletOperationRecord = {
  id: string
  merchant_id: string
  provider: string
  operation_type: string
  asset: string
  network: string
  amount: number
  destination_type: string
  destination_value: string | null
  status: WalletOperationStatus
  provider_operation_id: string | null
  provider_status: string | null
  error_code: string | null
  error_message: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type WalletOperationEventRecord = {
  id: string
  wallet_operation_id: string
  merchant_id: string
  event_type: string
  provider: string
  provider_event_id: string | null
  provider_status: string | null
  raw_payload: Record<string, unknown>
  created_at: string
}

export type CreateWalletOperationInput = {
  merchantId: string
  provider: "speed"
  operationType: "WITHDRAWAL_DRAFT"
  asset: "BTC"
  network: "bitcoin_lightning"
  amount: number
  destinationType: "lightning_invoice" | "bitcoin_address" | "provider_bank_payout"
  destinationValue?: string | null
  status: WalletOperationStatus
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

export type RecordWalletOperationEventInput = {
  walletOperationId: string
  merchantId: string
  eventType: string
  provider?: "speed"
  providerEventId?: string | null
  providerStatus?: string | null
  rawPayload?: Record<string, unknown>
}

function normalizeWalletOperation(row: WalletOperationRecord): WalletOperationRecord {
  return {
    ...row,
    amount: Number(row.amount),
    metadata: row.metadata || {}
  }
}

export async function createWalletOperation(
  input: CreateWalletOperationInput
): Promise<WalletOperationRecord> {
  const { data, error } = await db
    .from("wallet_operations")
    .insert({
      merchant_id: input.merchantId,
      provider: input.provider,
      operation_type: input.operationType,
      asset: input.asset,
      network: input.network,
      amount: input.amount,
      destination_type: input.destinationType,
      destination_value: input.destinationValue || null,
      status: input.status,
      provider_operation_id: null,
      provider_status: null,
      error_code: input.errorCode || null,
      error_message: input.errorMessage || null,
      metadata: input.metadata || {}
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to create wallet operation: ${error?.message || "No data returned"}`)
  }

  return normalizeWalletOperation(data as WalletOperationRecord)
}

export async function recordWalletOperationEvent(
  input: RecordWalletOperationEventInput
): Promise<WalletOperationEventRecord> {
  const { data, error } = await db
    .from("wallet_operation_events")
    .insert({
      wallet_operation_id: input.walletOperationId,
      merchant_id: input.merchantId,
      event_type: input.eventType,
      provider: input.provider || "speed",
      provider_event_id: input.providerEventId || null,
      provider_status: input.providerStatus || null,
      raw_payload: input.rawPayload || {}
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to record wallet operation event: ${error?.message || "No data returned"}`)
  }

  return data as WalletOperationEventRecord
}
