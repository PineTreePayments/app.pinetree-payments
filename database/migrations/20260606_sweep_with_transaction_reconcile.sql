-- ============================================================
-- PineTree Payments — Sweep + transaction reconciliation (complete)
-- Date: 2026-06-06
--
-- Supersedes:
--   20260605_sweep_stale_payments_function.sql
--   20260606_sweep_stale_payments_fix_evidence.sql
--
-- Changes in this version vs previous:
--   1. Removed provider_reference as a skip condition
--      (it holds the PineTree session ID, not broadcast evidence)
--   2. Tightened metadata evidence keys (removed transactionId /
--      transaction_id; added tx_hash, final_signature, etc.)
--   3. Added bulk transaction reconciliation step: when payments
--      are marked INCOMPLETE the linked non-terminal transaction
--      rows (PENDING / PROCESSING) with no provider_transaction_id
--      are set to INCOMPLETE.
--   4. Function return includes txIncomplete count.
--
-- Apply this migration in the Supabase SQL Editor.  It is safe to
-- re-run (CREATE OR REPLACE is idempotent).
-- ============================================================


-- ── Indexes (idempotent) ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payments_status_created_at
  ON public.payments (status, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_intents_payment_id
  ON public.payment_intents (payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_id
  ON public.payment_events (payment_id);

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
  v_lock_key    bigint      := 7283640912;
  v_locked      boolean;
  v_cutoff      timestamptz;
  v_scanned     integer := 0;
  v_marked      integer := 0;
  v_skipped     integer := 0;
  v_expired       integer := 0;   -- payment_intents expired
  v_tx_incomplete integer := 0;   -- transactions reconciled to INCOMPLETE
BEGIN
  SELECT pg_try_advisory_xact_lock(v_lock_key) INTO v_locked;
  IF NOT v_locked THEN
    RETURN jsonb_build_object(
      'locked', true, 'scanned', 0, 'markedIncomplete', 0,
      'expiredIntents', 0, 'txIncomplete', 0, 'skipped', 0, 'cutoff', null
    );
  END IF;

  v_cutoff := now() - stale_after;

  CREATE TEMP TABLE IF NOT EXISTS _sweep_candidates (
    id          uuid PRIMARY KEY,
    prev_status text NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _sweep_candidates;

  -- ── Candidate selection ───────────────────────────────────────────────────
  --
  -- A payment qualifies when ALL of:
  --   1. Status is CREATED or PENDING (terminal states excluded by filter).
  --   2. Older than stale_after.
  --   3. No transaction row with a non-empty provider_transaction_id.
  --   4. Metadata does not contain real broadcast / settlement evidence.
  --
  -- provider_reference is NOT a skip condition: it holds the PineTree
  -- session ID set at payment creation, not proof of funds broadcast.
  --
  -- Metadata keys that are NOT evidence (setup/config):
  --   split contract, wallet addresses, amounts, channel, terminalId,
  --   selectedAsset/Network, paymentIntentId, WalletConnect pairingUri,
  --   pos_base_session.step = awaiting_wallet / failed.
  --
  -- Metadata keys that ARE evidence:
  --   tx_hash / txHash / txhash / transactionHash / transaction_hash /
  --   blockchainHash / blockchain_hash / blockchainReference / blockchain_reference
  --   signature / finalSignature / final_signature / submittedSignature /
  --   submitted_signature / providerSignature / provider_signature
  --   providerTransactionId / provider_transaction_id (in metadata)
  --   broadcastMetadata / broadcast_metadata (non-empty object)
  --   receipt (non-empty object)
  --   status / provider_status / providerStatus in post-broadcast states
  --   payment_hash / paymentHash ONLY with co-located settlement indicator
  --   pos_base_session.step in post-broadcast states

  INSERT INTO _sweep_candidates (id, prev_status)
  SELECT p.id, p.status
  FROM   payments p
  WHERE  p.status IN ('CREATED', 'PENDING')
    AND  p.created_at < v_cutoff
    AND  NOT EXISTS (
           SELECT 1
           FROM   transactions t
           WHERE  t.payment_id = p.id
             AND  t.provider_transaction_id IS NOT NULL
             AND  trim(t.provider_transaction_id) <> ''
         )
    AND  NOT (
           p.metadata IS NOT NULL
           AND jsonb_typeof(p.metadata) = 'object'
           AND (
             (p.metadata ? 'tx_hash'              AND p.metadata->>'tx_hash'              <> '') OR
             (p.metadata ? 'txHash'               AND p.metadata->>'txHash'               <> '') OR
             (p.metadata ? 'txhash'               AND p.metadata->>'txhash'               <> '') OR
             (p.metadata ? 'transactionHash'      AND p.metadata->>'transactionHash'      <> '') OR
             (p.metadata ? 'transaction_hash'     AND p.metadata->>'transaction_hash'     <> '') OR
             (p.metadata ? 'blockchainHash'       AND p.metadata->>'blockchainHash'       <> '') OR
             (p.metadata ? 'blockchain_hash'      AND p.metadata->>'blockchain_hash'      <> '') OR
             (p.metadata ? 'blockchainReference'  AND p.metadata->>'blockchainReference'  <> '') OR
             (p.metadata ? 'blockchain_reference' AND p.metadata->>'blockchain_reference' <> '') OR
             (p.metadata ? 'signature'            AND p.metadata->>'signature'            <> '') OR
             (p.metadata ? 'finalSignature'       AND p.metadata->>'finalSignature'       <> '') OR
             (p.metadata ? 'final_signature'      AND p.metadata->>'final_signature'      <> '') OR
             (p.metadata ? 'submittedSignature'   AND p.metadata->>'submittedSignature'   <> '') OR
             (p.metadata ? 'submitted_signature'  AND p.metadata->>'submitted_signature'  <> '') OR
             (p.metadata ? 'providerSignature'    AND p.metadata->>'providerSignature'    <> '') OR
             (p.metadata ? 'provider_signature'   AND p.metadata->>'provider_signature'   <> '') OR
             (p.metadata ? 'providerTransactionId'   AND p.metadata->>'providerTransactionId'   <> '') OR
             (p.metadata ? 'provider_transaction_id' AND p.metadata->>'provider_transaction_id' <> '') OR
             (p.metadata ? 'broadcastMetadata'
                AND p.metadata -> 'broadcastMetadata' <> 'null'::jsonb
                AND p.metadata -> 'broadcastMetadata' <> '{}'::jsonb) OR
             (p.metadata ? 'broadcast_metadata'
                AND p.metadata -> 'broadcast_metadata' <> 'null'::jsonb
                AND p.metadata -> 'broadcast_metadata' <> '{}'::jsonb) OR
             (p.metadata ? 'receipt'
                AND p.metadata -> 'receipt' <> 'null'::jsonb
                AND p.metadata -> 'receipt' <> '{}'::jsonb) OR
             (p.metadata ? 'status'
                AND lower(p.metadata->>'status') IN (
                  'processing','submitted','broadcast',
                  'paid','settled','confirmed','complete','completed','mined'
                )) OR
             (p.metadata ? 'provider_status'
                AND lower(p.metadata->>'provider_status') IN (
                  'processing','submitted','broadcast',
                  'paid','settled','confirmed','complete','completed','mined'
                )) OR
             (p.metadata ? 'providerStatus'
                AND lower(p.metadata->>'providerStatus') IN (
                  'processing','submitted','broadcast',
                  'paid','settled','confirmed','complete','completed','mined'
                )) OR
             (
               (
                 (p.metadata ? 'payment_hash' AND p.metadata->>'payment_hash' <> '') OR
                 (p.metadata ? 'paymentHash'  AND p.metadata->>'paymentHash'  <> '')
               )
               AND (
                 (p.metadata ? 'settled' AND p.metadata->>'settled' IN ('true','1')) OR
                 (p.metadata ? 'state'   AND lower(p.metadata->>'state')  IN ('settled','paid','confirmed')) OR
                 (p.metadata ? 'status'  AND lower(p.metadata->>'status') IN ('settled','paid','confirmed'))
               )
             ) OR
             (p.metadata ? 'pos_base_session'
                AND jsonb_typeof(p.metadata -> 'pos_base_session') = 'object'
                AND (p.metadata -> 'pos_base_session') ? 'step'
                AND lower(p.metadata -> 'pos_base_session' ->> 'step') IN (
                  'broadcast','confirmed','completed',
                  'settled','paid','processing','submitted'
                ))
           )
         )
  ORDER BY p.created_at ASC
  LIMIT   max_rows
  FOR UPDATE OF p SKIP LOCKED;

  GET DIAGNOSTICS v_scanned = ROW_COUNT;

  IF v_scanned = 0 THEN
    RETURN jsonb_build_object(
      'locked', false, 'scanned', 0, 'markedIncomplete', 0,
      'expiredIntents', 0, 'txIncomplete', 0, 'skipped', 0, 'cutoff', v_cutoff
    );
  END IF;

  -- ── Mark payments INCOMPLETE ──────────────────────────────────────────────

  UPDATE payments p
  SET    status     = 'INCOMPLETE',
         updated_at = now()
  FROM   _sweep_candidates c
  WHERE  p.id = c.id
    AND  p.status IN ('CREATED', 'PENDING');

  GET DIAGNOSTICS v_marked = ROW_COUNT;
  v_skipped := v_scanned - v_marked;

  -- ── Insert payment_events for swept payments ──────────────────────────────

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

  -- ── Expire linked payment_intents ─────────────────────────────────────────

  UPDATE payment_intents pi
  SET    status     = 'EXPIRED',
         updated_at = now()
  FROM   _sweep_candidates c
  WHERE  pi.payment_id = c.id
    AND  pi.status <> 'EXPIRED';

  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- ── Reconcile linked transactions ─────────────────────────────────────────
  --
  -- For every payment that was just marked INCOMPLETE, set the linked
  -- transaction to INCOMPLETE provided:
  --   - the transaction status is non-terminal (PENDING or PROCESSING)
  --   - the transaction has no provider_transaction_id (no real on-chain evidence)
  --
  -- INCOMPLETE is the production standard for abandoned/unresolved transactions.
  -- This mirrors the TypeScript reconcileTransactionForPayment() logic for the
  -- SQL path so both code paths stay in sync.

  UPDATE transactions t
  SET    status     = 'INCOMPLETE',
         updated_at = now()
  FROM   _sweep_candidates c
  JOIN   payments p ON p.id = c.id
  WHERE  t.payment_id = c.id
    AND  p.status     = 'INCOMPLETE'
    AND  t.status     IN ('PENDING', 'PROCESSING')
    AND  (t.provider_transaction_id IS NULL OR trim(t.provider_transaction_id) = '');

  GET DIAGNOSTICS v_tx_incomplete = ROW_COUNT;

  RETURN jsonb_build_object(
    'locked',           false,
    'scanned',          v_scanned,
    'markedIncomplete', v_marked,
    'expiredIntents',   v_expired,
    'txIncomplete',     v_tx_incomplete,
    'skipped',          v_skipped,
    'cutoff',           v_cutoff
  );
END;
$$;


-- ── Permissions ───────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) TO service_role;
GRANT  EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) TO postgres;

NOTIFY pgrst, 'reload schema';
