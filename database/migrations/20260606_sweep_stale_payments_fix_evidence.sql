-- ============================================================
-- PineTree Payments — Fix sweep evidence rules
-- Date: 2026-06-06
--
-- Problem: provider_reference was used as a standalone skip
-- condition.  In practice, provider_reference holds the PineTree
-- payment/session ID that is set at payment creation — it is NOT
-- proof that funds were broadcast.  Old CREATED/PENDING rows were
-- being silently skipped because of this field alone.
--
-- Fix:
--   • Remove provider_reference skip condition entirely.
--   • Remove transactionId / transaction_id (PineTree internal IDs,
--     not blockchain hashes).
--   • Remove standalone paymentHash / payment_hash (Lightning
--     invoice hash is created before any payment — only treat it
--     as evidence when a co-located settlement indicator confirms
--     it was actually paid).
--   • Add precise broadcast evidence keys: tx_hash, txHash,
--     blockchain_hash, blockchainHash, final_signature,
--     finalSignature, submitted_signature, submittedSignature.
--   • Add status-field evidence: metadata.status /
--     provider_status / providerStatus showing a post-broadcast
--     state (processing, submitted, broadcast, paid, settled,
--     confirmed, completed, mined).
--   • Add receipt object evidence.
--   • Add pos_base_session.step evidence when step is in a
--     post-broadcast state (broadcast / confirmed / completed /
--     settled / paid / processing / submitted).  Steps
--     awaiting_wallet and failed are NOT evidence.
--
-- All other behaviour is unchanged: advisory lock, SKIP LOCKED,
-- max_rows cap, bulk UPDATE, payment_events insert,
-- payment_intents expiry, identical return shape.
-- ============================================================

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
  v_lock_key  bigint      := 7283640912;
  v_locked    boolean;
  v_cutoff    timestamptz;
  v_scanned   integer := 0;
  v_marked    integer := 0;
  v_skipped   integer := 0;
  v_expired   integer := 0;
BEGIN
  SELECT pg_try_advisory_xact_lock(v_lock_key) INTO v_locked;
  IF NOT v_locked THEN
    RETURN jsonb_build_object(
      'locked', true, 'scanned', 0, 'markedIncomplete', 0,
      'expiredIntents', 0, 'skipped', 0, 'cutoff', null
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
  -- A payment is a candidate when ALL of the following hold:
  --   1. Status is CREATED or PENDING (terminal states excluded by filter).
  --   2. Older than stale_after.
  --   3. No transaction row with a provider_transaction_id (on-chain reference).
  --   4. Metadata does not contain real broadcast/settlement evidence.
  --
  -- provider_reference is intentionally NOT a skip condition: it holds
  -- the PineTree session/payment ID set at creation and is not proof of
  -- funds being broadcast.
  --
  -- Metadata keys that are setup/config — NOT evidence:
  --   split contract, merchant/PineTree wallet addresses, expected/fee amounts,
  --   channel, terminalId, selectedAsset, selectedNetwork, paymentIntentId,
  --   WalletConnect pairingUri, pos_base_session.step = awaiting_wallet / failed.
  --
  -- Metadata keys that ARE evidence (non-empty / relevant value):
  --   tx_hash / txHash / txhash / transactionHash / transaction_hash /
  --   blockchainHash / blockchain_hash / blockchainReference / blockchain_reference
  --   — on-chain transaction identifier.
  --
  --   signature / finalSignature / final_signature /
  --   submittedSignature / submitted_signature /
  --   providerSignature / provider_signature
  --   — proof that a transaction was signed and broadcast.
  --
  --   providerTransactionId / provider_transaction_id (in metadata)
  --   — provider's reference to an on-chain or custodial transaction.
  --
  --   broadcastMetadata / broadcast_metadata (non-empty object)
  --   — provider broadcast response envelope.
  --
  --   receipt (non-empty object)  — on-chain receipt.
  --
  --   status / provider_status / providerStatus with value in
  --   (processing, submitted, broadcast, paid, settled, confirmed,
  --    complete, completed, mined)
  --   — provider reporting a post-broadcast state.
  --
  --   payment_hash / paymentHash ONLY when co-located with a settlement
  --   indicator (settled=true, state/status = settled|paid|confirmed)
  --   — Lightning invoice hash alone is NOT evidence (created before payment).
  --
  --   pos_base_session.step in (broadcast, confirmed, completed, settled,
  --   paid, processing, submitted)
  --   — POS session reached a post-broadcast step.

  INSERT INTO _sweep_candidates (id, prev_status)
  SELECT p.id, p.status
  FROM   payments p
  WHERE  p.status IN ('CREATED', 'PENDING')
    AND  p.created_at < v_cutoff
    -- Real transaction evidence: a linked transactions row with an on-chain ID
    AND  NOT EXISTS (
           SELECT 1
           FROM   transactions t
           WHERE  t.payment_id = p.id
             AND  t.provider_transaction_id IS NOT NULL
             AND  trim(t.provider_transaction_id) <> ''
         )
    -- Real metadata evidence
    AND  NOT (
           p.metadata IS NOT NULL
           AND jsonb_typeof(p.metadata) = 'object'
           AND (

             -- ── Blockchain transaction hashes ─────────────────────────────
             (p.metadata ? 'tx_hash'              AND p.metadata->>'tx_hash'              <> '') OR
             (p.metadata ? 'txHash'               AND p.metadata->>'txHash'               <> '') OR
             (p.metadata ? 'txhash'               AND p.metadata->>'txhash'               <> '') OR
             (p.metadata ? 'transactionHash'      AND p.metadata->>'transactionHash'      <> '') OR
             (p.metadata ? 'transaction_hash'     AND p.metadata->>'transaction_hash'     <> '') OR
             (p.metadata ? 'blockchainHash'       AND p.metadata->>'blockchainHash'       <> '') OR
             (p.metadata ? 'blockchain_hash'      AND p.metadata->>'blockchain_hash'      <> '') OR
             (p.metadata ? 'blockchainReference'  AND p.metadata->>'blockchainReference'  <> '') OR
             (p.metadata ? 'blockchain_reference' AND p.metadata->>'blockchain_reference' <> '') OR

             -- ── Signatures (broadcast evidence) ──────────────────────────
             (p.metadata ? 'signature'            AND p.metadata->>'signature'            <> '') OR
             (p.metadata ? 'finalSignature'       AND p.metadata->>'finalSignature'       <> '') OR
             (p.metadata ? 'final_signature'      AND p.metadata->>'final_signature'      <> '') OR
             (p.metadata ? 'submittedSignature'   AND p.metadata->>'submittedSignature'   <> '') OR
             (p.metadata ? 'submitted_signature'  AND p.metadata->>'submitted_signature'  <> '') OR
             (p.metadata ? 'providerSignature'    AND p.metadata->>'providerSignature'    <> '') OR
             (p.metadata ? 'provider_signature'   AND p.metadata->>'provider_signature'   <> '') OR

             -- ── Provider transaction IDs in metadata ──────────────────────
             (p.metadata ? 'providerTransactionId'   AND p.metadata->>'providerTransactionId'   <> '') OR
             (p.metadata ? 'provider_transaction_id' AND p.metadata->>'provider_transaction_id' <> '') OR

             -- ── Broadcast envelope (non-empty object) ─────────────────────
             (p.metadata ? 'broadcastMetadata'
                AND p.metadata -> 'broadcastMetadata' <> 'null'::jsonb
                AND p.metadata -> 'broadcastMetadata' <> '{}'::jsonb) OR
             (p.metadata ? 'broadcast_metadata'
                AND p.metadata -> 'broadcast_metadata' <> 'null'::jsonb
                AND p.metadata -> 'broadcast_metadata' <> '{}'::jsonb) OR

             -- ── On-chain receipt (non-empty object) ───────────────────────
             (p.metadata ? 'receipt'
                AND p.metadata -> 'receipt' <> 'null'::jsonb
                AND p.metadata -> 'receipt' <> '{}'::jsonb) OR

             -- ── Provider status field showing post-broadcast state ─────────
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

             -- ── Lightning payment_hash + settlement indicator ─────────────
             -- payment_hash alone is NOT evidence (set at invoice creation).
             -- Only protect when a co-located field confirms actual settlement.
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

             -- ── POS base session: post-broadcast step ─────────────────────
             -- awaiting_wallet and failed are NOT evidence.
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
      'expiredIntents', 0, 'skipped', 0, 'cutoff', v_cutoff
    );
  END IF;

  -- Bulk update (double-guard on status handles any concurrent transition)
  UPDATE payments p
  SET    status     = 'INCOMPLETE',
         updated_at = now()
  FROM   _sweep_candidates c
  WHERE  p.id = c.id
    AND  p.status IN ('CREATED', 'PENDING');

  GET DIAGNOSTICS v_marked = ROW_COUNT;
  v_skipped := v_scanned - v_marked;

  -- Bulk insert payment_events for successfully swept payments
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

  -- Bulk expire linked payment_intents
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

-- Permissions unchanged from 20260605 migration
REVOKE EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) TO service_role;
GRANT  EXECUTE ON FUNCTION public.sweep_stale_payments(integer, interval) TO postgres;

NOTIFY pgrst, 'reload schema';
