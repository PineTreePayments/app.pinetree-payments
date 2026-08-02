-- PineTree Shift4 database release preflight
-- static source validation only; read-only when executed.
DO $$
DECLARE
  v_missing text;
BEGIN
  IF current_setting('server_version_num')::integer < 140000 THEN RAISE EXCEPTION 'PostgreSQL 14 or newer is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'service_role is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN RAISE EXCEPTION 'anon is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN RAISE EXCEPTION 'authenticated is required'; END IF;
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN RAISE EXCEPTION 'gen_random_uuid() is required'; END IF;
  IF to_regclass('public.merchants') IS NULL OR to_regclass('public.payments') IS NULL OR to_regclass('public.merchant_providers') IS NULL THEN RAISE EXCEPTION 'Required PineTree parent relations are missing'; END IF;
  SELECT string_agg(required.column_name, ', ') INTO v_missing
    FROM (VALUES ('id','uuid'),('merchant_id','uuid'),('status','text')) required(column_name,data_type)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='payments' AND c.column_name=required.column_name AND c.data_type=required.data_type);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'payments columns/types missing: %', v_missing; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('ledger_accounts','ledger_transactions','ledger_journal_entries','ledger_links','shift4_tender_groups','shift4_payment_attempts','shift4_tokenization_sessions','shift4_onboarding_sessions','shift4_onboarding_events')) THEN RAISE EXCEPTION 'Release object collision detected'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('ledger_history_is_immutable','ledger_account_identity_is_immutable','assert_ledger_transaction_balanced','resolve_ledger_account','post_ledger_transaction','shift4_tender_group_identity_is_immutable','shift4_tender_group_is_undeletable','shift4_canonical_status_path','shift4_status_event_type','create_shift4_payment_attempt','claim_due_shift4_payment_attempts','apply_shift4_attempt_evidence','release_shift4_attempt_lease','enforce_shift4_tokenization_session_ownership','consume_shift4_tokenization_session','shift4_onboarding_guard_ownership','shift4_onboarding_touch_updated_at','shift4_onboarding_events_immutable','create_shift4_onboarding_session','apply_shift4_onboarding_update')) THEN RAISE EXCEPTION 'Release function collision detected'; END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger) AND current_user IN ('anon','authenticated') THEN RAISE EXCEPTION 'Browser role cannot own migration execution'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND contype='p') THEN RAISE EXCEPTION 'payments primary-key lifecycle assumption failed'; END IF;
  IF current_user IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'Migration owner must be a dedicated privileged owner, not an application role'; END IF;
  IF to_regclass('public.payment_events') IS NULL OR to_regclass('public.ledger_entries') IS NULL THEN RAISE EXCEPTION 'Required lifecycle/legacy ledger relations are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='gross_amount' AND data_type='numeric') THEN RAISE EXCEPTION 'payments.gross_amount numeric assumption failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='currency' AND data_type IN ('text','character varying','character')) THEN RAISE EXCEPTION 'payments.currency text assumption failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_events' AND column_name='raw_payload' AND data_type IN ('json','jsonb')) THEN RAISE EXCEPTION 'payment_events.raw_payload JSON assumption failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='ledger_entries' AND i.indisunique AND i.indnatts=1 AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=c.oid AND attname='payment_id' AND NOT attisdropped)) THEN RAISE EXCEPTION 'legacy ledger_entries(payment_id) uniqueness assumption failed'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('payment.reconciled'),('payment.pending'),('payment.processing'),('payment.confirmed'),('payment.failed'),('payment.canceled'),('payment.expired'),('payment.incomplete')) required(value) WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%payment.%' AND pg_get_constraintdef(oid) NOT LIKE ('%' || required.value || '%'))) THEN RAISE EXCEPTION 'payment_events event-type compatibility assumption failed'; END IF;
END;
$$;
SELECT current_user AS migration_actor, current_database() AS database_name, current_setting('server_version') AS postgres_version;
