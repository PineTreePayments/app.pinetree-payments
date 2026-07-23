import type { Payment } from "./payments"
import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"
import { SPEED_PROVIDER_NAME } from "./merchantProviders"

const db = supabaseAdmin || supabaseAnon

export type StalePaymentMaintenanceCandidate = Pick<Payment, "id" | "updated_at">

export async function getStalePaymentMaintenanceCandidates(input: {
  cutoff: string
  limit: number
  offset: number
}): Promise<StalePaymentMaintenanceCandidate[]> {
  const boundedLimit = Math.max(1, Math.min(input.limit, 100))
  const boundedOffset = Math.max(0, input.offset)
  const { data, error } = await db
    .from("payments")
    .select("id,updated_at")
    .in("status", ["CREATED", "PENDING"])
    .lt("updated_at", input.cutoff)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .range(boundedOffset, boundedOffset + boundedLimit - 1)

  if (error) {
    throw new Error(`Failed to load stale payment candidates: ${error.message}`)
  }

  return (data || []) as StalePaymentMaintenanceCandidate[]
}

export async function getPaymentMaintenanceCandidates(limit: number): Promise<Payment[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 25))
  const { data, error } = await db
    .from("payments")
    .select("*")
    .in("status", ["PENDING", "PROCESSING"])
    .order("updated_at", { ascending: true })
    .limit(boundedLimit)

  if (error) {
    throw new Error(`Failed to load payment maintenance candidates: ${error.message}`)
  }

  return (data || []) as Payment[]
}

export async function getTerminalPaymentMaintenanceCandidates(
  limit: number
): Promise<Array<Pick<Payment, "id" | "status">>> {
  const boundedLimit = Math.max(1, Math.min(limit, 25))
  const perStatusLimit = Math.max(1, Math.ceil(boundedLimit / 3))
  const terminalStatuses = ["CONFIRMED", "FAILED", "INCOMPLETE"] as const
  const results = await Promise.all(terminalStatuses.map(async (status) => {
    const { data, error } = await db
      .from("payments")
      .select("id,status,transactions!inner(status)")
      .eq("status", status)
      .neq("transactions.status", status)
      .order("updated_at", { ascending: true })
      .limit(perStatusLimit)

    if (error) {
      throw new Error(
        `Failed to load ${status} payment maintenance candidates: ${error.message}`
      )
    }

    return (data || []).map((row) => ({
      id: String(row.id),
      status: row.status as Payment["status"]
    }))
  }))

  const unique = new Map<string, Pick<Payment, "id" | "status">>()
  for (const row of results.flat()) {
    unique.set(row.id, row)
  }

  return Array.from(unique.values()).slice(0, boundedLimit)
}

/**
 * Non-terminal Speed Lightning payments, oldest first. Unlike
 * getPaymentMaintenanceCandidates, this is not gated on local "processing
 * evidence" - for Speed there is no local signal to gate on (all evidence
 * lives at Speed), and the whole point of reconciliation is to ask Speed
 * directly for payments nobody is actively polling anymore. `cutoff` keeps
 * this from racing the customer-facing checkout poller (lib/lightning/
 * lightningStatusPoller.ts), which already covers a payment's first few
 * minutes while a checkout session is typically still open.
 */
export async function getLightningReconciliationCandidates(input: {
  limit: number
  cutoff: string
}): Promise<Payment[]> {
  const boundedLimit = Math.max(1, Math.min(input.limit, 25))
  const { data, error } = await db
    .from("payments")
    .select("*")
    .in("status", ["PENDING", "PROCESSING"])
    .eq("network", "bitcoin_lightning")
    .eq("provider", SPEED_PROVIDER_NAME)
    .lt("updated_at", input.cutoff)
    .order("updated_at", { ascending: true })
    .limit(boundedLimit)

  if (error) {
    throw new Error(`Failed to load Lightning reconciliation candidates: ${error.message}`)
  }

  return (data || []) as Payment[]
}

/**
 * CONFIRMED Speed Lightning payments whose platform-fee settlement bookkeeping
 * is still "transfer_created" or "missing" - i.e. Speed's create-payment
 * response indicated a connect-split fee was expected, but no later check ever
 * confirmed a realized (transfer_id-bearing) APPLICATION_FEE transfer.
 *
 * getLightningReconciliationCandidates above only selects PENDING/PROCESSING
 * payments, so once a payment reaches CONFIRMED (e.g. the webhook that
 * advanced it arrived before Speed's transfers[] was fully populated for that
 * delivery), nothing ever re-checked fee settlement again - the payment
 * itself is correctly terminal, but its fee bookkeeping could stay "missing"
 * forever even when Speed's own side settled correctly. This candidate set
 * exists so a payment's *fee settlement status* can still be re-verified after
 * the payment's own status is already terminal, without ever re-advancing or
 * re-processing the payment's status itself (see
 * reconcileConfirmedLightningFeeSettlement).
 */
export async function getConfirmedLightningFeeSettlementCandidates(input: {
  limit: number
  cutoff: string
}): Promise<Payment[]> {
  const boundedLimit = Math.max(1, Math.min(input.limit, 25))
  const { data, error } = await db
    .from("payments")
    .select("*")
    .eq("status", "CONFIRMED")
    .eq("network", "bitcoin_lightning")
    .eq("provider", SPEED_PROVIDER_NAME)
    .in("metadata->split->lightningProviderMetadata->>feeSettlementStatus", ["transfer_created", "missing"])
    .lt("updated_at", input.cutoff)
    .order("updated_at", { ascending: true })
    .limit(boundedLimit)

  if (error) {
    throw new Error(`Failed to load Lightning fee-settlement reconciliation candidates: ${error.message}`)
  }

  return (data || []) as Payment[]
}
