import type { Payment } from "./payments"
import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"
import { SPEED_PROVIDER_NAME } from "./merchantProviders"

const db = supabaseAdmin || supabaseAnon

const LIGHTNING_NETWORK_FILTER = "bitcoin_lightning,btc_lightning,lightning_btc,lightning"
const SPEED_PROVIDER_FILTER = "lightning_speed,speed,tryspeed"
let recoverySchemaReady = false

function isMissingRecoveryRpc(error: { code?: string; message?: string } | null): boolean {
  const code = String(error?.code || "")
  const message = String(error?.message || "").toLowerCase()
  return code === "PGRST202" || code === "42883" || message.includes("could not find the function")
}

export async function isPaymentRecoverySchemaReady(): Promise<boolean> {
  if (recoverySchemaReady) return true
  const { data, error } = await db.rpc("payment_recovery_schema_ready")
  if (error) {
    if (isMissingRecoveryRpc(error)) return false
    throw new Error(`Failed to verify payment recovery schema: ${error.message}`)
  }
  recoverySchemaReady = data === true
  return recoverySchemaReady
}

export async function claimPaymentMaintenanceRun(
  leaseToken: string,
  leaseSeconds = 90
): Promise<
  | { claimed: true; reason: "claimed" }
  | { claimed: false; reason: "distributed_lease_active" | "recovery_schema_not_ready" }
> {
  const { data, error } = await db.rpc("claim_payment_maintenance_run", {
    p_lease_token: leaseToken,
    p_lease_seconds: Math.max(5, Math.min(Math.floor(leaseSeconds), 300)),
  })
  if (error) {
    if (isMissingRecoveryRpc(error)) {
      return { claimed: false, reason: "recovery_schema_not_ready" }
    }
    throw new Error(`Failed to claim payment maintenance lease: ${error.message}`)
  }
  return data === true
    ? { claimed: true, reason: "claimed" }
    : { claimed: false, reason: "distributed_lease_active" }
}
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
    // Provider-backed Lightning invoices must be reconciled before any generic
    // abandonment sweep. Null-root legacy rows are conservatively excluded too;
    // their selected attempt is classified by the provider-specific queue.
    .not("network", "is", null)
    .not("provider", "is", null)
    .not("network", "in", `(${LIGHTNING_NETWORK_FILTER})`)
    .not("provider", "in", `(${SPEED_PROVIDER_FILTER},lightning_nwc,nwc,lightning)`)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .range(boundedOffset, boundedOffset + boundedLimit - 1)

  if (error) {
    throw new Error(`Failed to load stale payment candidates: ${error.message}`)
  }

  return (data || []) as StalePaymentMaintenanceCandidate[]
}

export async function getPaymentMaintenanceCandidates(limit: number): Promise<Payment[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100))
  const { data, error } = await db
    .from("payments")
    .select("*")
    .in("status", ["CREATED", "PENDING", "PROCESSING"])
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
  const terminalMappings = [
    { paymentStatus: "CONFIRMED", transactionStatus: "CONFIRMED" },
    { paymentStatus: "FAILED", transactionStatus: "FAILED" },
    { paymentStatus: "INCOMPLETE", transactionStatus: "INCOMPLETE" },
    { paymentStatus: "EXPIRED", transactionStatus: "INCOMPLETE" },
    { paymentStatus: "CANCELED", transactionStatus: "INCOMPLETE" },
    { paymentStatus: "CANCELLED", transactionStatus: "INCOMPLETE" },
  ] as const
  const results = await Promise.all(terminalMappings.map(async ({ paymentStatus, transactionStatus }) => {
    const { data, error } = await db
      .from("payments")
      .select("id,status,updated_at,transactions!inner(status)")
      .eq("status", paymentStatus)
      .neq("transactions.status", transactionStatus)
      .order("updated_at", { ascending: true })
      // Each status can contribute the full bounded page. The merged result is
      // sorted globally below, so a fixed status ordering cannot permanently
      // crowd EXPIRED/CANCELED retries out of a small maintenance batch.
      .limit(boundedLimit)

    if (error) {
      throw new Error(
        `Failed to load ${paymentStatus} payment maintenance candidates: ${error.message}`
      )
    }

    return (data || []).map((row) => ({
      id: String(row.id),
      status: row.status as Payment["status"],
      updated_at: String(row.updated_at || "")
    }))
  }))

  const unique = new Map<string, Pick<Payment, "id" | "status" | "updated_at">>()
  for (const row of results.flat()) {
    unique.set(row.id, row)
  }

  return Array.from(unique.values())
    .sort((left, right) =>
      left.updated_at.localeCompare(right.updated_at) || left.id.localeCompare(right.id)
    )
    .slice(0, boundedLimit)
    .map(({ id, status }) => ({ id, status }))
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
  const boundedLimit = Math.max(1, Math.min(input.limit, 50))
  const directQuery = db
    .from("payments")
    .select("*")
    .in("status", ["CREATED", "PENDING", "PROCESSING"])
    .or(`network.in.(${LIGHTNING_NETWORK_FILTER}),provider.in.(${SPEED_PROVIDER_FILTER})`)
    .lt("updated_at", input.cutoff)
    .order("updated_at", { ascending: true })
    .limit(boundedLimit)

  // Historical rows can have null payment-root rail fields even though their
  // selected transaction attempt still identifies Speed/Lightning. Keep them
  // out of the generic abandonment sweep and recover them through that durable
  // attempt evidence instead of leaving them invisible to every queue.
  const relatedAttemptQuery = db
    .from("payments")
    .select("*,transactions!inner(provider,network)")
    .in("status", ["CREATED", "PENDING", "PROCESSING"])
    .or("network.is.null,provider.is.null")
    .or(
      `network.in.(${LIGHTNING_NETWORK_FILTER}),provider.in.(${SPEED_PROVIDER_FILTER})`,
      { referencedTable: "transactions" }
    )
    .lt("updated_at", input.cutoff)
    .order("updated_at", { ascending: true })
    .limit(boundedLimit)

  const [directResult, relatedAttemptResult] = await Promise.all([
    directQuery,
    relatedAttemptQuery,
  ])

  if (directResult.error) {
    throw new Error(`Failed to load Lightning reconciliation candidates: ${directResult.error.message}`)
  }
  if (relatedAttemptResult.error) {
    throw new Error(
      `Failed to load legacy Lightning reconciliation candidates: ${relatedAttemptResult.error.message}`
    )
  }

  const unique = new Map<string, Payment>()
  for (const rawRow of [...(directResult.data || []), ...(relatedAttemptResult.data || [])]) {
    const candidate = { ...(rawRow as Payment) } as Payment & { transactions?: unknown }
    delete candidate.transactions
    if (candidate.id) unique.set(candidate.id, candidate)
  }

  return Array.from(unique.values())
    .sort((left, right) =>
      String(left.updated_at || "").localeCompare(String(right.updated_at || "")) ||
      left.id.localeCompare(right.id)
    )
    .slice(0, boundedLimit)
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
/**
 * Recently terminal (INCOMPLETE/FAILED) Base payments, most-recent first, bounded
 * to a lookback window so a bad actor or a stuck cancel/timeout loop cannot
 * force unbounded repeated chain checks against very old records.
 *
 * Feeds engine/baseChainReconciliation.ts's self-healing pass: a payment
 * marked terminal before the engine ever saw its (later-confirmed)
 * on-chain transaction must eventually be repaired even if nothing
 * synchronous ever re-checks it.
 */
export async function getIncompleteBasePaymentReconciliationCandidates(input: {
  limit: number
  since: string
}): Promise<Pick<Payment, "id" | "updated_at">[]> {
  const boundedLimit = Math.max(1, Math.min(input.limit, 25))
  const { data, error } = await db
    .from("payments")
    .select("id,updated_at")
    .in("status", ["INCOMPLETE", "FAILED", "EXPIRED", "CANCELED", "CANCELLED"])
    .eq("network", "base")
    .gte("created_at", input.since)
    .order("updated_at", { ascending: false })
    .limit(boundedLimit)

  if (error) {
    throw new Error(`Failed to load incomplete Base reconciliation candidates: ${error.message}`)
  }

  return (data || []) as Pick<Payment, "id" | "updated_at">[]
}

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
