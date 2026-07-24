import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const LEASE_TABLE = "base_watcher_leases"

/**
 * Durable, cross-Vercel-instance single-flight claim for a Base payment's
 * on-chain confirmation check. Acquires the lease if no row exists yet, or
 * if the existing row's lease has already expired (steal). Returns false if
 * another instance currently holds a live lease - callers must skip their
 * check rather than run a concurrent, duplicate one.
 *
 * Fails OPEN (returns true) on any unexpected DB error, including the table
 * not existing yet (migration not applied) - a missing durable lock must
 * never block Base confirmation outright. The in-memory throttle in
 * engine/paymentMaintenance.ts remains the first line of defense regardless.
 */
export async function acquireBaseWatcherLease(
  paymentId: string,
  ttlMs: number
): Promise<boolean> {
  const now = Date.now()
  const lockedUntil = new Date(now + ttlMs).toISOString()

  const { error: insertError } = await supabase
    .from(LEASE_TABLE)
    .insert({ payment_id: paymentId, locked_until: lockedUntil })

  if (!insertError) return true

  if (insertError.code !== "23505") {
    console.warn("[baseWatcherLeases] acquire insert failed", {
      paymentId,
      error: insertError.message
    })
    return true
  }

  // A row already exists - only steal it if its lease has expired.
  const { data, error: updateError } = await supabase
    .from(LEASE_TABLE)
    .update({ locked_until: lockedUntil, updated_at: new Date(now).toISOString() })
    .eq("payment_id", paymentId)
    .lt("locked_until", new Date(now).toISOString())
    .select("payment_id")

  if (updateError) {
    console.warn("[baseWatcherLeases] acquire steal failed", {
      paymentId,
      error: updateError.message
    })
    return true
  }

  return Array.isArray(data) && data.length > 0
}

export async function releaseBaseWatcherLease(paymentId: string): Promise<void> {
  const { error } = await supabase.from(LEASE_TABLE).delete().eq("payment_id", paymentId)
  if (error) {
    console.warn("[baseWatcherLeases] release failed", { paymentId, error: error.message })
  }
}

/**
 * Read the block number the previous fallback-scan chunk walk stopped at for
 * this payment, if any. engine/baseChainReconciliation.ts uses this to
 * resume scanning progressively further back on each self-heal pass instead
 * of re-scanning the same newest-blocks window every time.
 */
export async function getBaseReconcileScanCursor(paymentId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from(LEASE_TABLE)
    .select("reconcile_scanned_to_block")
    .eq("payment_id", paymentId)
    .maybeSingle()

  if (error || !data) return null
  const value = data.reconcile_scanned_to_block
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export async function setBaseReconcileScanCursor(
  paymentId: string,
  scannedToBlock: number
): Promise<void> {
  // Update-then-insert (never a blind upsert): a row can already exist with
  // an active lease held by a concurrent watcher check, and this must only
  // ever touch the cursor column, never locked_until - clobbering a live
  // lease here would defeat the whole point of the durable single-flight
  // guard above.
  const nowIso = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from(LEASE_TABLE)
    .update({ reconcile_scanned_to_block: scannedToBlock, updated_at: nowIso })
    .eq("payment_id", paymentId)
    .select("payment_id")

  if (updateError) {
    console.warn("[baseWatcherLeases] set scan cursor update failed", {
      paymentId,
      error: updateError.message
    })
    return
  }

  if (Array.isArray(updated) && updated.length > 0) return

  const { error: insertError } = await supabase.from(LEASE_TABLE).insert({
    payment_id: paymentId,
    // No active lease exists yet at this insert - default to "already
    // expired" rather than holding a lease no caller asked for.
    locked_until: new Date(0).toISOString(),
    reconcile_scanned_to_block: scannedToBlock,
    updated_at: nowIso
  })

  // A concurrent insert (race with another caller creating the row between
  // our update-miss and this insert) is fine - the row now has a cursor
  // value either way. Any other error is best-effort/logged only.
  if (insertError && insertError.code !== "23505") {
    console.warn("[baseWatcherLeases] set scan cursor insert failed", {
      paymentId,
      error: insertError.message
    })
  }
}

export async function clearBaseReconcileScanCursor(paymentId: string): Promise<void> {
  const { error } = await supabase
    .from(LEASE_TABLE)
    .update({ reconcile_scanned_to_block: null, updated_at: new Date().toISOString() })
    .eq("payment_id", paymentId)
  if (error) {
    console.warn("[baseWatcherLeases] clear scan cursor failed", { paymentId, error: error.message })
  }
}
