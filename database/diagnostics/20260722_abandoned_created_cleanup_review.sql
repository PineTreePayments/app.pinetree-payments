-- Read-only review query for rows affected by the unsafe abandoned CREATED
-- cleanup. Do not mass-update these rows automatically; each row needs manual
-- provider/account matching before changing state.

SELECT
  id,
  merchant_id,
  provider_account_id,
  operation_type,
  direction,
  status,
  asset,
  network,
  amount_base_units,
  fee_base_units,
  destination_summary,
  provider_reference,
  provider_transaction_id,
  provider_secondary_reference,
  provider_status,
  failure_code,
  failure_reason,
  failed_at,
  submitted_at,
  completed_at,
  dispatch_started_at,
  dispatch_completed_at,
  provider_request_key,
  provider_request_attempted,
  provider_response_received,
  provider_acceptance_known,
  provider_acceptance_unknown,
  persistence_after_acceptance_failed,
  created_at,
  updated_at,
  raw_provider_status
FROM public.merchant_wallet_operations
WHERE provider = 'speed'
  AND operation_type = 'WITHDRAWAL'
  AND COALESCE(raw_provider_status, '{}'::jsonb) @> '{"failureStage":"abandoned_created_cleanup"}'::jsonb
ORDER BY created_at DESC;
