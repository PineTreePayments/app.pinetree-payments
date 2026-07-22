-- Finalize abandoned wallet withdrawal lifecycle states.
--
-- This migration intentionally does not touch legacy PROCESSING rows with
-- missing provider references. Those remain diagnostic/manual-recovery only.

UPDATE public.merchant_wallet_operations
SET failed_at = COALESCE(failed_at, updated_at, now())
WHERE status = 'FAILED'
  AND failed_at IS NULL;

CREATE OR REPLACE FUNCTION public.repair_abandoned_created_wallet_withdrawals(
  p_cutoff TIMESTAMPTZ DEFAULT now() - INTERVAL '15 minutes'
)
RETURNS TABLE (
  operation_id UUID,
  previous_status TEXT,
  new_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT mwo.id
    FROM public.merchant_wallet_operations mwo
    WHERE mwo.provider = 'speed'
      AND mwo.operation_type = 'WITHDRAWAL'
      AND mwo.status = 'CREATED'
      AND mwo.created_at < p_cutoff
      AND mwo.provider_reference IS NULL
      AND mwo.provider_transaction_id IS NULL
      AND mwo.provider_secondary_reference IS NULL
      AND mwo.submitted_at IS NULL
      AND mwo.tx_hash IS NULL
      AND mwo.explorer_url IS NULL
      AND mwo.failure_code IS NULL
      AND mwo.failure_reason IS NULL
      AND NOT (
        COALESCE(mwo.raw_provider_status, '{}'::jsonb) ?| ARRAY[
          'id',
          'withdraw_id',
          'providerReference',
          'providerTransactionId',
          'providerSecondaryReference',
          'txid',
          'tx_hash',
          'explorer_link'
        ]
      )
  ),
  repaired AS (
    UPDATE public.merchant_wallet_operations mwo
    SET
      status = 'FAILED',
      failure_code = COALESCE(mwo.failure_code, 'WITHDRAWAL_SUBMISSION_NOT_COMPLETED'),
      failure_reason = COALESCE(
        mwo.failure_reason,
        'Withdrawal submission did not complete before provider acceptance.'
      ),
      failed_at = COALESCE(mwo.failed_at, now()),
      raw_provider_status = COALESCE(mwo.raw_provider_status, '{}'::jsonb)
        || jsonb_build_object(
          'failureCode', 'WITHDRAWAL_SUBMISSION_NOT_COMPLETED',
          'failureStage', 'abandoned_created_cleanup',
          'cleanupCutoff', p_cutoff,
          'recoveryRequired', false
        )
    FROM candidates
    WHERE mwo.id = candidates.id
    RETURNING mwo.id
  )
  SELECT repaired.id, 'CREATED'::TEXT, 'FAILED'::TEXT
  FROM repaired;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_abandoned_created_wallet_withdrawals(TIMESTAMPTZ)
  FROM PUBLIC;

COMMENT ON FUNCTION public.repair_abandoned_created_wallet_withdrawals(TIMESTAMPTZ) IS
  'Safely marks abandoned Speed CREATED withdrawal rows as FAILED when no provider/submission evidence exists. Does not modify PROCESSING rows.';

SELECT *
FROM public.repair_abandoned_created_wallet_withdrawals(now() - INTERVAL '15 minutes');
