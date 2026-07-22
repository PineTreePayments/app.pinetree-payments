-- Prevent false-failure cleanup for ambiguous Speed withdrawals.
--
-- Production evidence showed a stale CREATED row with no provider reference
-- can still correspond to a provider-completed withdrawal. From this point
-- forward cleanup must classify unknown dispatch state as REQUIRES_ACTION,
-- never FAILED, unless PineTree has explicit pre-dispatch failure evidence.

ALTER TABLE public.merchant_wallet_operations
  ADD COLUMN IF NOT EXISTS dispatch_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_request_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_request_attempted BOOLEAN,
  ADD COLUMN IF NOT EXISTS provider_response_received BOOLEAN,
  ADD COLUMN IF NOT EXISTS provider_acceptance_known BOOLEAN,
  ADD COLUMN IF NOT EXISTS provider_acceptance_unknown BOOLEAN,
  ADD COLUMN IF NOT EXISTS persistence_after_acceptance_failed BOOLEAN;

COMMENT ON COLUMN public.merchant_wallet_operations.dispatch_started_at IS
  'Set immediately before PineTree dispatches a wallet operation request to the provider.';
COMMENT ON COLUMN public.merchant_wallet_operations.dispatch_completed_at IS
  'Set when PineTree receives a provider HTTP response or otherwise finishes the dispatch attempt.';
COMMENT ON COLUMN public.merchant_wallet_operations.provider_request_key IS
  'PineTree-generated provider request correlation key, normally provider:account:operation:idempotency_key.';
COMMENT ON COLUMN public.merchant_wallet_operations.provider_request_attempted IS
  'True only when PineTree has positive evidence that provider dispatch started.';
COMMENT ON COLUMN public.merchant_wallet_operations.provider_response_received IS
  'True when PineTree received a provider response for the dispatch attempt.';
COMMENT ON COLUMN public.merchant_wallet_operations.provider_acceptance_known IS
  'True when PineTree knows the provider accepted the operation.';
COMMENT ON COLUMN public.merchant_wallet_operations.provider_acceptance_unknown IS
  'True when duplicate-risk manual recovery is required because provider acceptance is unknown.';
COMMENT ON COLUMN public.merchant_wallet_operations.persistence_after_acceptance_failed IS
  'True when the provider accepted the operation but PineTree failed to persist the accepted response.';

CREATE INDEX IF NOT EXISTS merchant_wallet_operations_dispatch_review_idx
  ON public.merchant_wallet_operations (provider, operation_type, status, created_at)
  WHERE operation_type = 'WITHDRAWAL'
    AND (
      provider_acceptance_unknown IS TRUE
      OR persistence_after_acceptance_failed IS TRUE
      OR raw_provider_status @> '{"failureStage":"abandoned_created_cleanup"}'::jsonb
    );

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
    SELECT
      mwo.id,
      (
        mwo.provider_request_attempted IS FALSE
        AND COALESCE(mwo.raw_provider_status, '{}'::jsonb) @> '{"dispatchNotStarted": true}'::jsonb
      ) AS proven_pre_dispatch_failure
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
      status = CASE
        WHEN candidates.proven_pre_dispatch_failure THEN 'FAILED'
        ELSE 'REQUIRES_ACTION'
      END,
      failure_code = COALESCE(
        mwo.failure_code,
        CASE
          WHEN candidates.proven_pre_dispatch_failure THEN 'WITHDRAWAL_SUBMISSION_NOT_COMPLETED'
          ELSE 'STATUS_UNKNOWN'
        END
      ),
      failure_reason = COALESCE(
        mwo.failure_reason,
        CASE
          WHEN candidates.proven_pre_dispatch_failure
            THEN 'Withdrawal submission did not complete before provider dispatch.'
          ELSE 'Withdrawal dispatch status is unknown. Manual review is required before retrying.'
        END
      ),
      failed_at = CASE
        WHEN candidates.proven_pre_dispatch_failure THEN COALESCE(mwo.failed_at, now())
        ELSE NULL
      END,
      provider_acceptance_known = CASE
        WHEN candidates.proven_pre_dispatch_failure THEN false
        ELSE COALESCE(mwo.provider_acceptance_known, false)
      END,
      provider_acceptance_unknown = CASE
        WHEN candidates.proven_pre_dispatch_failure THEN false
        ELSE true
      END,
      raw_provider_status = COALESCE(mwo.raw_provider_status, '{}'::jsonb)
        || jsonb_build_object(
          'failureCode', CASE
            WHEN candidates.proven_pre_dispatch_failure THEN 'WITHDRAWAL_SUBMISSION_NOT_COMPLETED'
            ELSE 'STATUS_UNKNOWN'
          END,
          'failureStage', CASE
            WHEN candidates.proven_pre_dispatch_failure THEN 'staleCreatedProvenPreDispatchFailure'
            ELSE 'staleCreatedAmbiguous'
          END,
          'cleanupCutoff', p_cutoff,
          'recoveryRequired', NOT candidates.proven_pre_dispatch_failure,
          'staleCreatedAmbiguous', NOT candidates.proven_pre_dispatch_failure,
          'staleCreatedProvenPreDispatchFailure', candidates.proven_pre_dispatch_failure
        )
    FROM candidates
    WHERE mwo.id = candidates.id
    RETURNING mwo.id, candidates.proven_pre_dispatch_failure
  )
  SELECT
    repaired.id,
    'CREATED'::TEXT,
    CASE WHEN repaired.proven_pre_dispatch_failure THEN 'FAILED' ELSE 'REQUIRES_ACTION' END::TEXT
  FROM repaired;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_abandoned_created_wallet_withdrawals(TIMESTAMPTZ)
  FROM PUBLIC;

COMMENT ON FUNCTION public.repair_abandoned_created_wallet_withdrawals(TIMESTAMPTZ) IS
  'Conservatively classifies abandoned Speed CREATED withdrawals. Ambiguous dispatch state becomes REQUIRES_ACTION and requires manual recovery; only explicit pre-dispatch evidence can become FAILED.';
