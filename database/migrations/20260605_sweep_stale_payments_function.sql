-- ============================================================
-- PineTree Payments — Bounded stale-payment sweep function
-- Date: 2026-06-05
--
-- Replaces the TypeScript row-by-row sweep with a single
-- Postgres function that handles candidate selection, status
-- update, event insertion, and intent expiry in one transaction.
--
-- Advisory lock (pg_try_advisory_xact_lock) prevents overlapping
-- runs: a second caller returns {locked:true} immediately.
--
-- FOR UPDATE SKIP LOCKED: candidates are row-locked at selection
-- time so a concurrent process cannot race on the same rows.
--
-- Called via Supabase JS .rpc() from the Next.js cron endpoint,
-- which is itself protected by CRON_SECRET and triggered by
-- Supabase pg_cron + pg_net every 5 minutes.
-- ============================================================


-- ── Indexes (idempotent) ──────────────────────────────────────────────────────

-- Primary sweep scan: status filter + cutoff sort
CREATE INDEX IF NOT EXISTS idx_payments_status_created_at
  ON public.payments (status, created_at);

-- Intent expiry bulk update
CREATE INDEX IF NOT EXISTS idx_payment_intents_payment_id
  ON public.payment_intents (payment_id);

-- Event history queries (not used by sweep itself)
CREATE INDEX IF NOT EXISTS idx_payment_events_payment_id
  ON public.payment_events (payment_id);

-- Transaction evidence EXISTS subquery
CREATE INDEX IF NOT EXISTS idx_transactions_payment_id
  ON public.transactions (payment_id);


-- ── Function ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_stale_payments(
  max_rows    integer  DEFAULT 250,
  stale_after interval DEFAULT interval '5 minutes'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Stable advisory lock key unique to this cron job.
  v_lock_key  bigint      := 7283640912;
  v_locked    boolean;
  v_cutoff    timestamptz;
  v_scanned   integer := 0;
  v_marked    integer := 0;
  v_skipped   integer := 0;
  v_expired   integer := 0;
BEGIN
  -- Try advisory lock (transaction-scoped; released automatically on commit/rollback).
  -- A second overlapping sweep returns immediately without touching any rows.
  SELECT pg_try_advisory_xact_lock(v_lock_key) INTO v_locked;
  IF NOT v_locked THEN
    RETURN jsonb_build_object(
      'locked', true, 'scanned', 0, 'markedIncomplete', 0,
      'expiredIntents', 0, 'skipped', 0, 'cutoff', null
    );
  END IF;

  v_cutoff := now() - stale_after;

  -- Temp table holds candidates + their pre-update status for event payloads.
  -- IF NOT EXISTS + TRUNCATE is safe when the function is called multiple times
  -- within the same session (e.g. in tests).  ON COMMIT DROP ensures cleanup.
  CREATE TEMP TABLE IF NOT EXISTS _sweep_candidates (
    id          uuid PRIMARY KEY,
    prev_status text NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _sweep_candidates;

  -- Select up to max_rows stale candidates with a row lock so concurrent
  -- processes cannot race.  Evidence checks mirror the TypeScript
  -- metadataHasBroadcastEvidence logic: any top-level JSON key from the
  -- broadcast evidence set with a non-empty string value causes the payment
  -- to be skipped conservatively.
  INSERT INTO _sweep_candidates (id, prev_status)
  SELECT p.id, p.status
  FROM   payments p
  WHERE  p.status IN ('CREATED', 'PENDING')
    AND  p.created_at < v_cutoff
    -- skip if an explicit provider_reference is set
    AND  (p.provider_reference IS NULL OR trim(p.provider_reference) = '')
    -- skip if any transaction record has a non-empty provider_transaction_id
    AND  NOT EXISTS (
           SELECT 1
           FROM   transactions t
           WHERE  t.payment_id = p.id
             AND  t.provider_transaction_id IS NOT NULL
             AND  trim(t.provider_transaction_id) <> ''
         )
    -- skip if metadata contains broadcast evidence keys with non-empty values
    AND  NOT (
           p.metadata IS NOT NULL
           AND jsonb_typeof(p.metadata) = 'object'
           AND (
             (p.metadata ? 'txhash'                 AND p.metadata->>'txhash'                 <> '') OR
             (p.metadata ? 'transactionHash'         AND p.metadata->>'transactionHash'         <> '') OR
             (p.metadata ? 'transaction_hash'        AND p.metadata->>'transaction_hash'        <> '') OR
             (p.metadata ? 'transactionId'           AND p.metadata->>'transactionId'           <> '') OR
             (p.metadata ? 'transaction_id'          AND p.metadata->>'transaction_id'          <> '') OR
             (p.metadata ? 'signature'               AND p.metadata->>'signature'               <> '') OR
             (p.metadata ? 'providerSignature'       AND p.metadata->>'providerSignature'       <> '') OR
             (p.metadata ? 'provider_signature'      AND p.metadata->>'provider_signature'      <> '') OR
             (p.metadata ? 'providerTransactionId'   AND p.metadata->>'providerTransactionId'   <> '') OR
             (p.metadata ? 'provider_transaction_id' AND p.metadata->>'provider_transaction_id' <> '') OR
             (p.metadata ? 'blockchainReference'     AND p.metadata->>'blockchainReference'     <> '') OR
             (p.metadata ? 'blockchain_reference'    AND p.metadata->>'blockchain_reference'    <> '') OR
             (p.metadata ? 'paymentHash'             AND p.metadata->>'paymentHash'             <> '') OR
             (p.metadata ? 'payment_hash'            AND p.metadata->>'payment_hash'             <> '') OR
             (p.metadata ? 'broadcastMetadata'
                AND p.metadata -> 'broadcastMetadata' <> 'null'::jsonb
                AND p.metadata -> 'broadcastMetadata' <> '{}'::jsonb) OR
             (p.metadata ? 'broadcast_metadata'
                AND p.metadata -> 'broadcast_metadata' <> 'null'::jsonb
                AND p.metadata -> 'broadcast_metadata' <> '{}'::jsonb)
           )
         )
  ORDER BY p.created_at ASC
  LIMIT   max_rows
  FOR UPDATE OF p SKIP LOCKED;

  GET DIAGNOSTICS v_scanned = ROW_COUNT;

  IF v_scanned = 0 THEN
    RETURN jsonb_build_object(
      'locked', false, 'scanned', 0, 'markedIncomplete', 0,
      'expiredIntents', 0, 'skipped', 0, 'cutoff', v_cutoff
    );
  END IF;

  -- Bulk update payments to INCOMPLETE.
  -- Double-guard on status handles the edge case where a payment was
  -- concurrently updated between candidate selection and this update.
  UPDATE payments p
  SET    status     = 'INCOMPLETE',
         updated_at = now()
  FROM   _sweep_candidates c
  WHERE  p.id = c.id
    AND  p.status IN ('CREATED', 'PENDING');

  GET DIAGNOSTICS v_marked = ROW_COUNT;
  v_skipped := v_scanned - v_marked;

  -- Bulk insert payment_events only for payments that were actually updated.
  INSERT INTO payment_events
         (id, payment_id, event_type, provider_event, raw_payload, created_at)
  SELECT gen_random_uuid(),
         c.id,
         'payment.incomplete',
         'cron.stale_payment_sweep',
         jsonb_build_object(
           'sweepReason',    'no_activity_timeout',
           'timeoutMinutes', 5,
           'previousStatus', c.prev_status,
           'cutoff',         v_cutoff
         ),
         now()
  FROM   _sweep_candidates c
  WHERE  EXISTS (
           SELECT 1 FROM payments p2
           WHERE  p2.id = c.id AND p2.status = 'INCOMPLETE'
         );

  -- Bulk expire linked payment_intents.
  UPDATE payment_intents pi
  SET    status     = 'EXPIRED',
         updated_at = now()
  FROM   _sweep_candidates c
  WHERE  pi.payment_id = c.id
    AND  pi.status <> 'EXPIRED';

  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'locked',           false,
    'scanned',          v_scanned,
    'markedIncomplete', v_marked,
    'expiredIntents',   v_expired,
    'skipped',          v_skipped,
    'cutoff',           v_cutoff
  );
END;
$$;


-- ── Permissions ───────────────────────────────────────────────────────────────

-- Deny direct execution to anon and authenticated roles.
-- Only the API server (service_role key) and the database owner may call this.
REVOKE EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) TO service_role;
GRANT  EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) TO postgres;

-- Notify PostgREST to register the new function signature
NOTIFY pgrst, 'reload schema';
