-- Read-only inspection for the two reported stuck transaction rows.
-- Replace the two values below with the PineTree payment IDs from the dashboard.
WITH target_payments(payment_id) AS (
  VALUES
    ('REPLACE_WITH_PAYMENT_ID_1'::uuid),
    ('REPLACE_WITH_PAYMENT_ID_2'::uuid)
)
SELECT
  p.id AS payment_id,
  pi.id AS intent_id,
  t.id AS transaction_id,
  p.provider,
  p.network,
  COALESCE(
    p.metadata -> 'split' ->> 'asset',
    p.metadata -> 'split' ->> 'nativeSymbol',
    p.metadata ->> 'selectedAsset'
  ) AS asset,
  p.status AS payment_status,
  pi.status AS intent_status,
  t.status AS transaction_status,
  p.created_at,
  p.updated_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(p.updated_at, p.created_at))) / 60, 1)
    AS payment_age_minutes,
  CASE
    WHEN terminal_event.event_type = 'payment.cancelled' THEN terminal_event.created_at
  END AS canceled_at,
  CASE
    WHEN terminal_event.event_type = 'payment.expired' THEN terminal_event.created_at
  END AS expired_at,
  p.provider_reference,
  (NULLIF(BTRIM(COALESCE(p.provider_reference, '')), '') IS NOT NULL)
    AS provider_reference_present_not_submission_evidence,
  (NULLIF(BTRIM(COALESCE(t.provider_transaction_id, '')), '') IS NOT NULL)
    AS transaction_submission_evidence,
  COALESCE(evidence_event.has_processing_event, FALSE)
    AS processing_event_evidence,
  COALESCE(evidence_event.has_hash_payload, FALSE)
    AS event_hash_or_signature_evidence,
  (
    NULLIF(BTRIM(COALESCE(p.metadata ->> 'txHash', '')), '') IS NOT NULL OR
    NULLIF(BTRIM(COALESCE(p.metadata ->> 'transactionHash', '')), '') IS NOT NULL OR
    NULLIF(BTRIM(COALESCE(p.metadata ->> 'signature', '')), '') IS NOT NULL OR
    NULLIF(BTRIM(COALESCE(p.metadata ->> 'submittedTransactionId', '')), '') IS NOT NULL
  ) AS payment_metadata_submission_evidence,
  terminal_event.provider_event,
  terminal_event.raw_payload ->> 'reason' AS lifecycle_reason,
  p.metadata ->> 'incompleteReason' AS payment_metadata_reason,
  (p.status IN ('CONFIRMED', 'FAILED', 'INCOMPLETE')) AS payment_is_terminal,
  (pi.status = 'EXPIRED') AS intent_is_terminal,
  (
    p.status IN ('CONFIRMED', 'FAILED', 'INCOMPLETE') AND
    t.id IS NOT NULL AND
    t.status IS DISTINCT FROM p.status
  ) AS transaction_snapshot_disagrees,
  CASE
    WHEN p.status IN ('CONFIRMED', 'FAILED', 'INCOMPLETE')
      THEN 'not eligible: payment already terminal'
    WHEN p.status = 'PROCESSING'
      THEN 'not eligible for expiration: processing requires watcher reconciliation'
    WHEN p.status NOT IN ('CREATED', 'PENDING')
      THEN 'not eligible: unsupported active state'
    WHEN NOW() - COALESCE(p.updated_at, p.created_at) < INTERVAL '5 minutes'
      THEN 'not eligible: checkout timeout not reached'
    WHEN NULLIF(BTRIM(COALESCE(t.provider_transaction_id, '')), '') IS NOT NULL
      OR COALESCE(evidence_event.has_processing_event, FALSE)
      OR COALESCE(evidence_event.has_hash_payload, FALSE)
      OR NULLIF(BTRIM(COALESCE(p.metadata ->> 'txHash', '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(p.metadata ->> 'transactionHash', '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(p.metadata ->> 'signature', '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(p.metadata ->> 'submittedTransactionId', '')), '') IS NOT NULL
      THEN 'not eligible: canonical submitted-payment evidence indicator present'
    ELSE 'eligible: stale active payment with no submitted-payment evidence indicator'
  END AS eligible_for_maintenance
FROM target_payments target
JOIN payments p ON p.id = target.payment_id
LEFT JOIN payment_intents pi ON pi.payment_id = p.id
LEFT JOIN transactions t ON t.payment_id = p.id
LEFT JOIN LATERAL (
  SELECT pe.event_type, pe.provider_event, pe.raw_payload, pe.created_at
  FROM payment_events pe
  WHERE pe.payment_id = p.id
    AND pe.event_type IN ('payment.cancelled', 'payment.expired', 'payment.incomplete')
  ORDER BY pe.created_at DESC
  LIMIT 1
) terminal_event ON TRUE
LEFT JOIN LATERAL (
  SELECT
    BOOL_OR(pe.event_type IN ('payment.processing', 'payment.confirmed', 'payment.failed'))
      AS has_processing_event,
    BOOL_OR(
      NULLIF(BTRIM(COALESCE(pe.raw_payload ->> 'txHash', '')), '') IS NOT NULL OR
      NULLIF(BTRIM(COALESCE(pe.raw_payload ->> 'transactionHash', '')), '') IS NOT NULL OR
      NULLIF(BTRIM(COALESCE(pe.raw_payload ->> 'signature', '')), '') IS NOT NULL OR
      NULLIF(BTRIM(COALESCE(pe.raw_payload ->> 'submittedTransactionId', '')), '') IS NOT NULL
    ) AS has_hash_payload
  FROM payment_events pe
  WHERE pe.payment_id = p.id
) evidence_event ON TRUE
ORDER BY p.created_at DESC;
