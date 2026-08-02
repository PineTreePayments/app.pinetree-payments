-- PineTree Shift4 executable transaction-contained runtime smoke tests.
-- Supabase SQL Editor compatible. This file contains no client-side variables.
-- It invokes database functions only; it has no provider or network capability.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $smoke$
DECLARE
  /* Every fixture identity is generated inside this rollback-only transaction.
     No operator-supplied row or provider credential is accepted. */
  v_run text := replace(gen_random_uuid()::text, '-', '');
  v_merchant_id uuid := gen_random_uuid();
  v_payment_a_id uuid := gen_random_uuid();
  v_payment_b_id uuid := gen_random_uuid();
  v_connection_id uuid := gen_random_uuid();
  v_other_merchant uuid := gen_random_uuid();
  v_smoke_email text := 'shift4-smoke-' || v_run || '@example.invalid';
  v_smoke_business_name text := 'Shift4 rollback smoke ' || v_run;

  /* S01-S18 use payment A as their primary disposable fixture. */
  v_payment_id uuid := v_payment_a_id;
  v_connection_1_id uuid := v_connection_id;
  v_payment public.payments%rowtype;
  v_payment_a public.payments%rowtype;
  v_payment_b public.payments%rowtype;
  v_total bigint;
  v_total_b bigint;
  v_half bigint;
  v_half_b bigint;
  v_remainder bigint;
  v_remainder_b bigint;
  v_invoice_base bigint;
  v_invoices text[] := array[]::text[];
  v_i integer;
  v_account_debit uuid;
  v_account_credit uuid;
  v_create record;
  v_apply record;
  v_post_a record;
  v_post_b record;
  v_group public.shift4_tender_groups%rowtype;
  v_group_a public.shift4_tender_groups%rowtype;
  v_group_b public.shift4_tender_groups%rowtype;
  v_attempt public.shift4_payment_attempts%rowtype;
  v_attempt_a public.shift4_payment_attempts%rowtype;
  v_attempt_b public.shift4_payment_attempts%rowtype;
  v_before_count integer;
  v_after_count integer;
  v_before_version integer;
  v_before_sequence integer;
  v_before_status text;
  v_error text;
  v_code text;
  v_session public.shift4_onboarding_sessions%rowtype;
  v_session_2 public.shift4_onboarding_sessions%rowtype;
  v_event_id uuid;
  v_event_occurred_at timestamptz;
  v_event_count integer;
  v_token_result text;
  v_token_id uuid;
  v_fingerprint text;
  v_captured_before bigint;
  v_captured_after bigint;
  v_remaining_before bigint;
  v_fee_before integer;
  v_fee_after integer;
  v_payment_a_event_count integer;
  v_payment_b_event_count integer;
  v_payment_a_attempt_count integer;
  v_payment_b_attempt_count integer;
  v_payment_a_fee_count integer;
  v_payment_b_fee_count integer;
  v_payment_b_status text;
  v_payment_b_group_version integer;
BEGIN
  IF v_payment_a_id = v_payment_b_id THEN
    RAISE EXCEPTION 'Generated synthetic payment identities unexpectedly collided';
  END IF;
  IF current_setting('transaction_read_only')::boolean THEN
    RAISE EXCEPTION 'Smoke tests require a writable transaction that can be rolled back';
  END IF;

  /* Refuse even an astronomically unlikely UUID collision. This proves every
     selected fixture row is inserted by this run, never preexisting data. */
  IF EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=v_merchant_id)
     OR EXISTS (SELECT 1 FROM public.merchant_providers mp WHERE mp.id=v_connection_id)
     OR EXISTS (SELECT 1 FROM public.payments p WHERE p.id IN (v_payment_a_id,v_payment_b_id)) THEN
    RAISE EXCEPTION 'Generated synthetic fixture UUID collides with a preexisting row';
  END IF;

  INSERT INTO public.merchants (
    id, email, business_name, created_at
  ) VALUES (
    v_merchant_id, v_smoke_email, v_smoke_business_name, clock_timestamp()
  );

  INSERT INTO public.merchant_providers (
    id, merchant_id, provider, enabled, credentials, created_at, updated_at
  ) VALUES (
    v_connection_id, v_merchant_id, 'shift4_rest', true,
    jsonb_build_object('synthetic',true,'rollbackOnly',true,'smokeRun',v_run),
    clock_timestamp(), clock_timestamp()
  );

  INSERT INTO public.payments (
    id, merchant_id, subtotal_amount, platform_fee, total_amount,
    merchant_amount, pinetree_fee, gross_amount,
    currency, provider, provider_reference, network, payment_url, metadata, status
  ) VALUES
  (
    v_payment_a_id, v_merchant_id, 200, 15, 215, 2.00, 0.15, 2.15,
    'USD', 'shift4', 'smoke-'||v_run||'-payment-a', 'shift4',
    'pinetree://shift4-smoke/'||v_payment_a_id::text,
    jsonb_build_object(
      'synthetic',true,'rollbackOnly',true,'smokeRun',v_run,'fixturePayment','A',
      'merchantAmountMinor',200,'pinetreeFeeMinor',15,'grossAmountMinor',215
    ),
    'CREATED'
  ),
  (
    v_payment_b_id, v_merchant_id, 300, 15, 315, 3.00, 0.15, 3.15,
    'USD', 'shift4', 'smoke-'||v_run||'-payment-b', 'shift4',
    'pinetree://shift4-smoke/'||v_payment_b_id::text,
    jsonb_build_object(
      'synthetic',true,'rollbackOnly',true,'smokeRun',v_run,'fixturePayment','B',
      'merchantAmountMinor',300,'pinetreeFeeMinor',15,'grossAmountMinor',315
    ),
    'CREATED'
  );

  IF NOT EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=v_merchant_id) THEN
    RAISE EXCEPTION 'Generated synthetic merchant does not exist after insertion';
  END IF;

  SELECT * INTO v_payment_a FROM public.payments p WHERE p.id=v_payment_a_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generated synthetic payment A does not exist'; END IF;
  v_payment := v_payment_a;
  IF v_payment_a.merchant_id IS DISTINCT FROM v_merchant_id THEN
    RAISE EXCEPTION 'Generated payment A does not belong to synthetic merchant';
  END IF;
  IF upper(coalesce(v_payment_a.status, '')) <> 'CREATED' THEN
    RAISE EXCEPTION 'Unsafe payment A status %; only a pristine CREATED synthetic payment is accepted', v_payment_a.status;
  END IF;
  IF upper(coalesce(v_payment_a.currency, '')) NOT IN ('USD','CAD')
     OR v_payment_a.subtotal_amount IS NULL
     OR v_payment_a.platform_fee IS NULL
     OR v_payment_a.total_amount IS NULL
     OR v_payment_a.gross_amount IS NULL
     OR v_payment_a.merchant_amount IS NULL
     OR v_payment_a.pinetree_fee IS NULL
     OR v_payment_a.subtotal_amount <> v_payment_a.merchant_amount * 100
     OR v_payment_a.platform_fee <> v_payment_a.pinetree_fee * 100
     OR v_payment_a.total_amount <> v_payment_a.gross_amount * 100
     OR v_payment_a.subtotal_amount + v_payment_a.platform_fee <> v_payment_a.total_amount
     OR v_payment_a.merchant_amount + v_payment_a.pinetree_fee <> v_payment_a.gross_amount
     OR v_payment_a.pinetree_fee <> 0.15 THEN
    RAISE EXCEPTION 'Synthetic payment A requires exact dual-model USD/CAD money';
  END IF;
  v_total := v_payment_a.total_amount;
  IF v_total < 200 THEN RAISE EXCEPTION 'Synthetic payment A must be at least 200 minor units'; END IF;

  SELECT * INTO v_payment_b FROM public.payments p WHERE p.id=v_payment_b_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generated synthetic payment B does not exist'; END IF;
  IF v_payment_b.merchant_id IS DISTINCT FROM v_merchant_id THEN
    RAISE EXCEPTION 'Generated payment B does not belong to synthetic merchant';
  END IF;
  IF upper(coalesce(v_payment_b.status, '')) <> 'CREATED' THEN
    RAISE EXCEPTION 'Unsafe payment B status %; only a pristine CREATED synthetic payment is accepted', v_payment_b.status;
  END IF;
  IF upper(coalesce(v_payment_b.currency, '')) NOT IN ('USD','CAD')
     OR v_payment_b.subtotal_amount IS NULL
     OR v_payment_b.platform_fee IS NULL
     OR v_payment_b.total_amount IS NULL
     OR v_payment_b.gross_amount IS NULL
     OR v_payment_b.merchant_amount IS NULL
     OR v_payment_b.pinetree_fee IS NULL
     OR v_payment_b.subtotal_amount <> v_payment_b.merchant_amount * 100
     OR v_payment_b.platform_fee <> v_payment_b.pinetree_fee * 100
     OR v_payment_b.total_amount <> v_payment_b.gross_amount * 100
     OR v_payment_b.subtotal_amount + v_payment_b.platform_fee <> v_payment_b.total_amount
     OR v_payment_b.merchant_amount + v_payment_b.pinetree_fee <> v_payment_b.gross_amount
     OR v_payment_b.pinetree_fee <> 0.15 THEN
    RAISE EXCEPTION 'Synthetic payment B requires exact dual-model USD/CAD money';
  END IF;
  v_total_b := v_payment_b.total_amount;
  IF v_total_b < 200 THEN RAISE EXCEPTION 'Synthetic payment B must be at least 200 minor units'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_providers mp
     WHERE mp.id=v_connection_id AND mp.merchant_id=v_merchant_id AND mp.provider='shift4_rest'
       AND mp.status='active' AND mp.enabled=true
  ) THEN RAISE EXCEPTION 'Synthetic provider connection is missing, cross-tenant, disabled, not active, or not exactly shift4_rest'; END IF;

  IF EXISTS (SELECT 1 FROM public.shift4_payment_attempts a WHERE a.payment_id=v_payment_a_id)
     OR EXISTS (SELECT 1 FROM public.shift4_tender_groups g WHERE g.payment_id=v_payment_a_id)
     OR EXISTS (SELECT 1 FROM public.shift4_tokenization_sessions s WHERE s.payment_id=v_payment_a_id)
     OR EXISTS (SELECT 1 FROM public.ledger_links l WHERE l.payment_id=v_payment_a_id) THEN
    RAISE EXCEPTION 'Unsafe non-pristine payment A; existing Shift4 or journal evidence was found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift4_payment_attempts a WHERE a.payment_id=v_payment_b_id)
     OR EXISTS (SELECT 1 FROM public.shift4_tender_groups g WHERE g.payment_id=v_payment_b_id)
     OR EXISTS (SELECT 1 FROM public.shift4_tokenization_sessions s WHERE s.payment_id=v_payment_b_id)
     OR EXISTS (SELECT 1 FROM public.ledger_links l WHERE l.payment_id=v_payment_b_id) THEN
    RAISE EXCEPTION 'Unsafe non-pristine payment B; existing Shift4 or journal evidence was found';
  END IF;

  v_half := v_total / 2;
  v_remainder := v_total - v_half;
  v_half_b := v_total_b / 2;
  v_remainder_b := v_total_b - v_half_b;
  v_invoice_base := substring(translate(v_run, 'abcdef', '123456') from 1 for 10)::bigint;
  FOR v_i IN 1..40 LOOP
    v_invoices[v_i] := lpad(((v_invoice_base + v_i) % 10000000000)::text, 10, '0');
  END LOOP;
  v_account_debit := public.resolve_ledger_account('merchant', v_merchant_id::text, 'adjustment_suspense', upper(v_payment_a.currency), '', 'minor', 2);
  v_account_credit := public.resolve_ledger_account('merchant', v_merchant_id::text, 'merchant_receivable', upper(v_payment_a.currency), '', 'minor', 2);

  BEGIN
    SELECT * INTO v_post_a FROM public.post_ledger_transaction(
      'smoke.s01.' || v_run, 'v1', 'smoke.balance', 'adjustment', v_merchant_id,
      upper(v_payment.currency),
      jsonb_build_array(
        jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',101,'memo','smoke'),
        jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',101,'memo','smoke')
      )
    );
    IF NOT v_post_a.created OR (
      SELECT coalesce(sum(CASE WHEN e.side='debit' THEN e.amount_minor ELSE -e.amount_minor END),1)
        FROM public.ledger_journal_entries e WHERE e.ledger_transaction_id=v_post_a.ledger_transaction_id
    ) <> 0 THEN RAISE EXCEPTION 'S01 balanced journal assertion failed'; END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S01 balanced journal posting passed';
  END;

  BEGIN
    v_error := null;
    BEGIN
      PERFORM * FROM public.post_ledger_transaction(
        'smoke.s02.' || v_run, 'v1', 'smoke.unbalanced', 'adjustment', v_merchant_id,
        upper(v_payment.currency),
        jsonb_build_array(
          jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',101),
          jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',100)
        )
      );
    EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
    END;
    IF v_error IS NULL OR v_error NOT ILIKE '%unbalanced%' THEN RAISE EXCEPTION 'S02 did not reject the unbalanced journal: %', v_error; END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S02 unbalanced journal rejection passed';
  END;

  BEGIN
    SELECT * INTO v_post_a FROM public.post_ledger_transaction(
      'smoke.s03.' || v_run, 'v1', 'smoke.replay', 'adjustment', v_merchant_id,
      upper(v_payment.currency),
      jsonb_build_array(
        jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',103),
        jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',103)
      )
    );
    SELECT * INTO v_post_b FROM public.post_ledger_transaction(
      'smoke.s03.' || v_run, 'v1', 'smoke.replay', 'adjustment', v_merchant_id,
      upper(v_payment.currency),
      jsonb_build_array(
        jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',103),
        jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',103)
      )
    );
    IF NOT v_post_a.created OR v_post_b.created OR v_post_a.ledger_transaction_id <> v_post_b.ledger_transaction_id THEN
      RAISE EXCEPTION 'S03 identical replay did not collapse';
    END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S03 identical posting replay passed';
  END;

  BEGIN
    PERFORM * FROM public.post_ledger_transaction(
      'smoke.s04.' || v_run, 'v1', 'smoke.conflict', 'adjustment', v_merchant_id,
      upper(v_payment.currency),
      jsonb_build_array(
        jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',104),
        jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',104)
      )
    );
    v_error := null;
    BEGIN
      PERFORM * FROM public.post_ledger_transaction(
        'smoke.s04.' || v_run, 'v1', 'smoke.conflict', 'adjustment', v_merchant_id,
        upper(v_payment.currency),
        jsonb_build_array(
          jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',105),
          jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',105)
        )
      );
    EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
    END;
    IF v_error IS NULL OR v_error NOT ILIKE '%different journal lines%' THEN RAISE EXCEPTION 'S04 posting conflict was not rejected: %', v_error; END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S04 posting-key conflict passed';
  END;

  BEGIN
    v_error := null;
    BEGIN
      PERFORM * FROM public.post_ledger_transaction(
        'smoke.s05.' || v_run, 'v1', 'smoke.account_mismatch', 'payment', v_other_merchant,
        upper(v_payment.currency),
        jsonb_build_array(
          jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',105),
          jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',105)
        ),
        jsonb_build_array(jsonb_build_object('link_type','payment','record_id',v_payment_id::text,'payment_id',v_payment_id))
      );
    EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
    END;
    IF v_error IS NULL OR v_error NOT ILIKE '%another merchant%' THEN RAISE EXCEPTION 'S05 account/merchant mismatch was not rejected: %', v_error; END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S05 account and merchant mismatch passed';
  END;

  BEGIN
    v_error := null;
    BEGIN
      PERFORM * FROM public.post_ledger_transaction(
        'smoke.s06.' || v_run, 'v1', 'smoke.invalid_link', 'payment', v_merchant_id,
        upper(v_payment.currency),
        jsonb_build_array(
          jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',106),
          jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',106)
        ),
        jsonb_build_array(
          jsonb_build_object('link_type','payment','record_id',v_payment_id::text,'payment_id',v_payment_id),
          jsonb_build_object('link_type','payment_event','record_id',gen_random_uuid()::text,'payment_id',v_payment_id,'payment_event_id',gen_random_uuid())
        )
      );
    EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
    END;
    IF v_error IS NULL OR v_error NOT ILIKE '%event that does not exist%' THEN RAISE EXCEPTION 'S06 nonexistent payment-event ledger link was not rejected: %', v_error; END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S06 nonexistent payment-event ledger-link rejection passed';
  END;

  BEGIN
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s07', v_other_merchant, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[7],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s07','fp-'||v_run||'-s07','corr-'||v_run||'-s07'
    );
    IF v_create.outcome <> 'rejected' OR v_create.conflict_reason <> 'payment_not_owned_by_merchant'
       OR EXISTS (SELECT 1 FROM public.shift4_payment_attempts a WHERE a.attempt_id='smoke-'||v_run||'-s07') THEN
      RAISE EXCEPTION 'S07 cross-tenant rejection failed';
    END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S07 cross-tenant attempt rejection passed';
  END;

  BEGIN
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s08', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[8],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s08','fp-'||v_run||'-s08','corr-'||v_run||'-s08'
    );
    SELECT * INTO v_attempt FROM public.shift4_payment_attempts a WHERE a.id=v_create.attempt_row_id;
    IF v_create.outcome <> 'created' OR v_attempt.merchant_id <> v_merchant_id
       OR v_attempt.payment_id <> v_payment_id OR v_attempt.merchant_provider_connection_id <> v_connection_1_id
       OR v_attempt.invoice <> v_invoices[8]
       OR NOT EXISTS (SELECT 1 FROM public.payment_events e WHERE e.payment_id=v_payment_id AND e.provider_event='shift4.attempt_created' AND e.raw_payload->>'attemptId'=v_attempt.attempt_id) THEN
      RAISE EXCEPTION 'S08 durable attempt assertion failed';
    END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S08 durable attempt creation passed';
  END;

  BEGIN
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s09', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[9],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s09','fp-'||v_run||'-s09','corr-'||v_run||'-s09'
    );
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s09', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'PROCESSING',
      p_response_code=>'P', p_approved_amount_minor=>v_half, p_authorized_amount_minor=>v_half
    );
    SELECT * INTO v_attempt FROM public.shift4_payment_attempts a WHERE a.id=v_create.attempt_row_id;
    IF v_apply.outcome <> 'applied' OR v_apply.applied_status <> 'PROCESSING'
       OR v_attempt.attempt_role <> 'partial_authorization' OR v_attempt.approved_amount_minor <> v_half
       OR v_attempt.remaining_amount_minor <> v_remainder OR v_attempt.recovery_state <> 'none' THEN
      RAISE EXCEPTION 'S09 valid partial approval contract failed';
    END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S09 valid P partial approval passed';
  END;

  BEGIN
    FOREACH v_code IN ARRAY ARRAY['A','C'] LOOP
      SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
        'smoke-'||v_run||'-s09b-'||lower(v_code), v_merchant_id, v_payment_id, v_connection_1_id,
        'authorization','ecommerce',v_invoices[CASE WHEN v_code='A' THEN 10 ELSE 11 END],v_total,upper(v_payment.currency),
        'idem-'||v_run||'-s09b-'||v_code,'fp-'||v_run||'-s09b-'||v_code,'corr-'||v_run||'-s09b-'||v_code
      );
      SELECT count(*) INTO v_before_count FROM public.shift4_payment_attempts a WHERE a.tender_group_id=(SELECT tender_group_id FROM public.shift4_payment_attempts WHERE id=v_create.attempt_row_id);
      SELECT g.* INTO v_group FROM public.shift4_tender_groups g JOIN public.shift4_payment_attempts a ON a.tender_group_id=g.id WHERE a.id=v_create.attempt_row_id;
      v_before_sequence := v_group.next_tender_sequence;
      v_before_status := (SELECT p.status FROM public.payments p WHERE p.id=v_payment_id);
      SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
        p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s09b-'||lower(v_code), p_expected_version=>v_create.version,
        p_state=>'approved', p_recovery_state=>'none', p_target_status=>'PROCESSING',
        p_response_code=>v_code, p_approved_amount_minor=>v_half, p_authorized_amount_minor=>v_half
      );
      SELECT * INTO v_attempt FROM public.shift4_payment_attempts a WHERE a.id=v_create.attempt_row_id;
      SELECT * INTO v_group FROM public.shift4_tender_groups g WHERE g.id=v_attempt.tender_group_id;
      SELECT count(*) INTO v_after_count FROM public.shift4_payment_attempts a WHERE a.tender_group_id=v_attempt.tender_group_id;
      IF v_apply.outcome <> 'reconciliation_required' OR NOT v_apply.reconciliation_required
         OR v_apply.conflict_reason <> 'approved_amount_below_requested' OR v_apply.ledger_posted
         OR v_apply.applied_status IS NOT NULL OR v_attempt.state <> 'reconciliation_required'
         OR v_attempt.recovery_state <> 'blocked' OR v_attempt.attempt_role='partial_authorization'
         OR v_group.next_tender_sequence <> v_before_sequence OR v_after_count <> v_before_count
         OR (SELECT p.status FROM public.payments p WHERE p.id=v_payment_id) <> v_before_status THEN
        RAISE EXCEPTION 'S09b short % reconciliation contract failed', v_code;
      END IF;
    END LOOP;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S09b short A/C reconciliation behavior passed';
  END;

  BEGIN
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s10-auth1', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[12],v_half,upper(v_payment.currency),
      'idem-'||v_run||'-s10-auth1','fp-'||v_run||'-s10-auth1','corr-'||v_run||'-s10-auth1'
    );
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s10-auth1', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'PROCESSING',
      p_response_code=>'A', p_approved_amount_minor=>v_half, p_authorized_amount_minor=>v_half
    );
    IF v_apply.outcome <> 'applied' THEN RAISE EXCEPTION 'S10 first authorization was not applied'; END IF;

    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s10-auth2', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[13],v_remainder,upper(v_payment.currency),
      'idem-'||v_run||'-s10-auth2','fp-'||v_run||'-s10-auth2','corr-'||v_run||'-s10-auth2'
    );
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s10-auth2', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'PROCESSING',
      p_response_code=>'A', p_approved_amount_minor=>v_remainder, p_authorized_amount_minor=>v_remainder
    );
    IF v_apply.outcome NOT IN ('applied','already_applied') THEN RAISE EXCEPTION 'S10 second authorization evidence failed'; END IF;

    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s10-cap1', v_merchant_id, v_payment_id, v_connection_1_id,
      'capture','ecommerce',v_invoices[12],v_half,upper(v_payment.currency),
      'idem-'||v_run||'-s10-cap1','fp-'||v_run||'-s10-cap1','corr-'||v_run||'-s10-cap1',
      p_related_attempt_id=>'smoke-'||v_run||'-s10-auth1', p_attempt_role=>'capture'
    );
    IF v_create.outcome <> 'created' THEN RAISE EXCEPTION 'S10 first capture was not durably created: %', v_create.conflict_reason; END IF;
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s10-cap1', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'CONFIRMED',
      p_response_code=>'A', p_approved_amount_minor=>v_half, p_authorized_amount_minor=>v_half
    );
    IF v_apply.outcome NOT IN ('applied','already_applied') OR NOT v_apply.ledger_posted
       OR (SELECT p.status FROM public.payments p WHERE p.id=v_payment_id) <> 'PROCESSING' THEN
      RAISE EXCEPTION 'S10 first capture did not remain PROCESSING';
    END IF;

    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s11-cap2', v_merchant_id, v_payment_id, v_connection_1_id,
      'capture','ecommerce',v_invoices[13],v_remainder,upper(v_payment.currency),
      'idem-'||v_run||'-s11-cap2','fp-'||v_run||'-s11-cap2','corr-'||v_run||'-s11-cap2',
      p_related_attempt_id=>'smoke-'||v_run||'-s10-auth2', p_attempt_role=>'capture'
    );
    IF v_create.outcome <> 'created' THEN RAISE EXCEPTION 'S11 second capture was not durably created: %', v_create.conflict_reason; END IF;
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s11-cap2', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'CONFIRMED',
      p_response_code=>'A', p_approved_amount_minor=>v_remainder, p_authorized_amount_minor=>v_remainder
    );
    SELECT coalesce(sum(a.approved_amount_minor),0) INTO v_captured_after
      FROM public.shift4_payment_attempts a
     WHERE a.tender_group_id=(SELECT tender_group_id FROM public.shift4_payment_attempts WHERE attempt_id='smoke-'||v_run||'-s11-cap2')
       AND a.operation IN ('sale','capture') AND a.state='approved';
    IF v_apply.outcome <> 'applied' OR v_apply.applied_status <> 'CONFIRMED'
       OR v_captured_after <> v_total THEN RAISE EXCEPTION 'S11 exact two-capture total failed'; END IF;

    SELECT count(*) INTO v_fee_after
      FROM public.ledger_transactions t
      JOIN public.ledger_links l ON l.ledger_transaction_id=t.id
     WHERE t.event_type='shift4.platform_fee' AND l.link_type='payment' AND l.payment_id=v_payment_id;
    IF v_fee_after <> 1 THEN RAISE EXCEPTION 'S12 expected exactly one platform fee, found %', v_fee_after; END IF;
    IF (SELECT p.status FROM public.payments p WHERE p.id=v_payment_id) <> 'CONFIRMED'
       OR NOT EXISTS (SELECT 1 FROM public.shift4_tender_groups g WHERE g.payment_id=v_payment_id AND g.merchant_provider_connection_id=v_connection_1_id AND g.state='settled') THEN
      RAISE EXCEPTION 'S13 exact confirmation assertion failed';
    END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN
    RAISE NOTICE 'S10 first capture remains processing passed';
    RAISE NOTICE 'S11 second capture exact-total passed';
    RAISE NOTICE 'S12 platform fee exactly once passed';
    RAISE NOTICE 'S13 payment confirmation at exact total passed';
  END;

  BEGIN
    v_token_id := gen_random_uuid();
    INSERT INTO public.shift4_tokenization_sessions(
      session_id,merchant_id,payment_id,merchant_provider_connection_id,
      completion_secret_hash,status,expires_at
    ) VALUES (v_token_id,v_merchant_id,v_payment_id,v_connection_1_id,repeat('a',64),'created',clock_timestamp()+interval '1 hour');
    v_token_result := public.consume_shift4_tokenization_session(v_token_id,v_merchant_id,repeat('a',64),repeat('b',24));
    IF v_token_result <> 'consumed_now' THEN RAISE EXCEPTION 'S14 first token consume returned %', v_token_result; END IF;
    v_token_result := public.consume_shift4_tokenization_session(v_token_id,v_merchant_id,repeat('a',64),repeat('b',24));
    IF v_token_result <> 'already_consumed' THEN RAISE EXCEPTION 'S14 identical token replay returned %', v_token_result; END IF;
    v_token_result := public.consume_shift4_tokenization_session(v_token_id,v_merchant_id,repeat('a',64),repeat('c',24));
    IF v_token_result <> 'fingerprint_conflict' THEN RAISE EXCEPTION 'S14 changed fingerprint returned %', v_token_result; END IF;
    v_token_result := public.consume_shift4_tokenization_session(v_token_id,v_other_merchant,repeat('a',64),repeat('b',24));
    IF v_token_result <> 'unavailable' THEN RAISE EXCEPTION 'S14 cross-merchant consume returned %', v_token_result; END IF;
    SELECT token_fingerprint INTO v_fingerprint FROM public.shift4_tokenization_sessions WHERE session_id=v_token_id;
    IF v_fingerprint <> repeat('b',24) THEN RAISE EXCEPTION 'S14 stored fingerprint changed'; END IF;

    v_token_id := gen_random_uuid();
    INSERT INTO public.shift4_tokenization_sessions(
      session_id,merchant_id,payment_id,merchant_provider_connection_id,
      completion_secret_hash,status,expires_at,created_at
    ) VALUES (v_token_id,v_merchant_id,v_payment_id,v_connection_1_id,repeat('d',64),'created',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '2 hours');
    v_token_result := public.consume_shift4_tokenization_session(v_token_id,v_merchant_id,repeat('d',64),repeat('e',24));
    IF v_token_result <> 'unavailable' THEN RAISE EXCEPTION 'S14 expired session returned %', v_token_result; END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S14 token consumption and refusal cases passed';
  END;

  BEGIN
    SELECT * INTO v_session FROM public.create_shift4_onboarding_session(
      v_merchant_id,v_connection_1_id,'app-'||v_run||'-1','launch-'||v_run||'-1',null,'application_started','corr-'||v_run||'-onboard-1'
    );
    SELECT * INTO v_session FROM public.apply_shift4_onboarding_update(
      v_merchant_id,v_connection_1_id,'app-'||v_run||'-1','new-decline-'||v_run,
      'declined','newer_decline',clock_timestamp(),'corr-'||v_run||'-new-decline',true,'fixture'
    );
    SELECT * INTO v_session FROM public.apply_shift4_onboarding_update(
      v_merchant_id,v_connection_1_id,'app-'||v_run||'-1','old-approval-'||v_run,
      'approved',null,clock_timestamp()-interval '1 day','corr-'||v_run||'-old-approval',true,'fixture'
    );
    IF v_session.status <> 'declined' OR v_session.status_reason_code <> 'newer_decline' THEN
      RAISE EXCEPTION 'S15 delayed old approval replaced newer decline';
    END IF;
    SELECT count(*) INTO v_event_count FROM public.shift4_onboarding_events e WHERE e.onboarding_session_id=v_session.id;
    IF v_event_count <> 2 THEN RAISE EXCEPTION 'S15 append-only ordering evidence count was %', v_event_count; END IF;
    SELECT e.occurred_at INTO STRICT v_event_occurred_at
      FROM public.shift4_onboarding_events e
     WHERE e.onboarding_session_id=v_session.id AND e.update_reference='old-approval-'||v_run;
    SELECT * INTO v_session FROM public.apply_shift4_onboarding_update(
      v_merchant_id,v_connection_1_id,'app-'||v_run||'-1','old-approval-'||v_run,
      'approved',null,v_event_occurred_at,
      'corr-'||v_run||'-old-approval',true,'fixture'
    );
    SELECT count(*) INTO v_after_count FROM public.shift4_onboarding_events e WHERE e.onboarding_session_id=v_session.id;
    IF v_after_count <> 2 OR v_session.status <> 'declined' THEN RAISE EXCEPTION 'S15 identical replay was not idempotent'; END IF;

    v_error := null;
    BEGIN
      PERFORM * FROM public.apply_shift4_onboarding_update(
        v_merchant_id,v_connection_1_id,'app-'||v_run||'-1','old-approval-'||v_run,
        'blocked','conflict',clock_timestamp()-interval '1 day','corr-'||v_run||'-conflict',true,'fixture'
      );
    EXCEPTION WHEN unique_violation THEN v_error := SQLERRM;
    END;
    IF v_error IS NULL OR v_error NOT ILIKE '%idempotency conflict%' THEN RAISE EXCEPTION 'S15 conflicting update reference was not rejected'; END IF;
    SELECT * INTO v_session_2 FROM public.create_shift4_onboarding_session(
      v_merchant_id,v_connection_id,'app-'||v_run||'-2','launch-'||v_run||'-2',null,'application_started','corr-'||v_run||'-onboard-2'
    );
    SELECT * INTO v_session_2 FROM public.apply_shift4_onboarding_update(
      v_merchant_id,v_connection_id,'app-'||v_run||'-2','new-approval-'||v_run,
      'approved',null,clock_timestamp(),'corr-'||v_run||'-new-approval',true,'fixture'
    );
    SELECT * INTO v_session_2 FROM public.apply_shift4_onboarding_update(
      v_merchant_id,v_connection_id,'app-'||v_run||'-2','old-decline-'||v_run,
      'declined','older_decline',clock_timestamp()-interval '1 day','corr-'||v_run||'-old-decline',true,'fixture'
    );
    IF v_session_2.status <> 'approved' OR v_session_2.status_reason_code IS NOT NULL
       OR v_session.status <> 'declined' THEN RAISE EXCEPTION 'S15 delayed old decline replaced newer approval or crossed sessions'; END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S15 onboarding ordering, replay, conflict, and session isolation passed';
  END;

  BEGIN
    SELECT * INTO v_post_a FROM public.post_ledger_transaction(
      'smoke.s16.' || v_run, 'v1', 'smoke.immutable', 'adjustment', v_merchant_id,
      upper(v_payment.currency),
      jsonb_build_array(
        jsonb_build_object('account_id',v_account_debit,'side','debit','amount_minor',116),
        jsonb_build_object('account_id',v_account_credit,'side','credit','amount_minor',116)
      )
    );
    v_error := null;
    BEGIN UPDATE public.ledger_transactions SET source='mutated' WHERE id=v_post_a.ledger_transaction_id;
    EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
    IF v_error IS NULL OR v_error NOT ILIKE '%append-only%' THEN RAISE EXCEPTION 'S16 ledger update was not rejected'; END IF;

    SELECT * INTO v_session FROM public.create_shift4_onboarding_session(
      v_merchant_id,v_connection_1_id,'app-'||v_run||'-16','launch-'||v_run||'-16',null,'application_started','corr-'||v_run||'-16'
    );
    PERFORM * FROM public.apply_shift4_onboarding_update(
      v_merchant_id,v_connection_1_id,'app-'||v_run||'-16','update-'||v_run||'-16',
      'received',null,clock_timestamp(),'corr-'||v_run||'-16-update',true,'fixture'
    );
    SELECT id INTO v_event_id FROM public.shift4_onboarding_events WHERE onboarding_session_id=v_session.id;
    v_error := null;
    BEGIN UPDATE public.shift4_onboarding_events SET correlation_id='mutated' WHERE id=v_event_id;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN v_error := SQLERRM; END;
    IF v_error IS NULL OR v_error NOT ILIKE '%append-only%' THEN RAISE EXCEPTION 'S16 onboarding update was not rejected'; END IF;
    v_error := null;
    BEGIN DELETE FROM public.shift4_onboarding_events WHERE id=v_event_id;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN v_error := SQLERRM; END;
    IF v_error IS NULL OR v_error NOT ILIKE '%append-only%' THEN RAISE EXCEPTION 'S16 onboarding delete was not rejected'; END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S16 journal and onboarding append-only evidence passed';
  END;

  BEGIN
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s17', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[17],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s17','fp-'||v_run||'-s17','corr-'||v_run||'-s17'
    );
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s17', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'PROCESSING',
      p_response_code=>'P', p_approved_amount_minor=>v_half, p_authorized_amount_minor=>v_half
    );
    SELECT * INTO v_attempt FROM public.shift4_payment_attempts a WHERE a.id=v_create.attempt_row_id;
    IF v_attempt.attempt_role <> 'partial_authorization' THEN RAISE EXCEPTION 'S17 evidence did not mutate the role'; END IF;
    SELECT * INTO v_group FROM public.shift4_tender_groups g WHERE g.id=v_attempt.tender_group_id;
    v_before_sequence := v_group.next_tender_sequence;
    SELECT count(*) INTO v_before_count FROM public.shift4_payment_attempts a WHERE a.tender_group_id=v_group.id;

    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s17', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[17],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s17','fp-'||v_run||'-s17','corr-'||v_run||'-s17'
    );
    IF v_create.outcome <> 'resumed' THEN RAISE EXCEPTION 'S17 stable identity did not resume after role mutation'; END IF;
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s17', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[17],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s17','changed-fp-'||v_run||'-s17','corr-'||v_run||'-s17'
    );
    IF v_create.outcome <> 'idempotency_conflict' THEN RAISE EXCEPTION 'S17 changed fingerprint did not conflict'; END IF;
    SELECT * INTO v_group FROM public.shift4_tender_groups g WHERE g.id=v_attempt.tender_group_id;
    SELECT count(*) INTO v_after_count FROM public.shift4_payment_attempts a WHERE a.tender_group_id=v_group.id;
    IF v_group.next_tender_sequence <> v_before_sequence OR v_after_count <> v_before_count THEN
      RAISE EXCEPTION 'S17 retry mutated tender allocation';
    END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S17 stable idempotency after evidence role mutation passed';
  END;

  BEGIN
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s18', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[18],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s18','fp-'||v_run||'-s18','corr-'||v_run||'-s18'
    );
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s18', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'PROCESSING',
      p_response_code=>'A', p_approved_amount_minor=>v_total, p_authorized_amount_minor=>v_total
    );
    SELECT * INTO v_attempt FROM public.shift4_payment_attempts a WHERE a.id=v_create.attempt_row_id;
    SELECT * INTO v_group FROM public.shift4_tender_groups g WHERE g.id=v_attempt.tender_group_id;
    v_before_version := v_group.version;
    v_before_sequence := v_group.next_tender_sequence;
    SELECT count(*) INTO v_before_count FROM public.shift4_payment_attempts a WHERE a.tender_group_id=v_group.id;
    SELECT count(*) INTO v_event_count FROM public.payment_events e WHERE e.payment_id=v_payment_id;

    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s18', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[18],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s18','fp-'||v_run||'-s18','corr-'||v_run||'-s18'
    );
    IF v_create.outcome <> 'resumed' THEN RAISE EXCEPTION 'S18 resume outcome failed'; END IF;
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s18-conflict', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[18],v_total,upper(v_payment.currency),
      'idem-'||v_run||'-s18','different-fp-'||v_run,'corr-'||v_run||'-s18-conflict'
    );
    IF v_create.outcome <> 'idempotency_conflict' THEN RAISE EXCEPTION 'S18 idempotency conflict outcome failed'; END IF;
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s18-invoice', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[18],1,upper(v_payment.currency),
      'idem-'||v_run||'-s18-invoice','fp-'||v_run||'-s18-invoice','corr-'||v_run||'-s18-invoice'
    );
    IF v_create.outcome <> 'invoice_collision' THEN RAISE EXCEPTION 'S18 invoice collision outcome failed'; END IF;
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s18-over', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce',v_invoices[19],1,upper(v_payment.currency),
      'idem-'||v_run||'-s18-over','fp-'||v_run||'-s18-over','corr-'||v_run||'-s18-over'
    );
    IF v_create.outcome <> 'rejected' OR v_create.conflict_reason <> 'tender_would_exceed_payment_total' THEN
      RAISE EXCEPTION 'S18 over-total rejection outcome failed';
    END IF;
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s18-invalid', v_merchant_id, v_payment_id, v_connection_1_id,
      'authorization','ecommerce','invalid',1,upper(v_payment.currency),
      'idem-'||v_run||'-s18-invalid','fp-'||v_run||'-s18-invalid','corr-'||v_run||'-s18-invalid'
    );
    IF v_create.outcome <> 'rejected' OR v_create.conflict_reason <> 'invoice_is_invalid' THEN
      RAISE EXCEPTION 'S18 validation rejection outcome failed';
    END IF;
    SELECT * INTO v_group FROM public.shift4_tender_groups g WHERE g.id=v_attempt.tender_group_id;
    SELECT count(*) INTO v_after_count FROM public.shift4_payment_attempts a WHERE a.tender_group_id=v_group.id;
    IF v_group.version <> v_before_version OR v_group.next_tender_sequence <> v_before_sequence
       OR v_after_count <> v_before_count
       OR (SELECT count(*) FROM public.payment_events e WHERE e.payment_id=v_payment_id) <> v_event_count THEN
      RAISE EXCEPTION 'S18 rejected/resumed/conflicting paths mutated durable state';
    END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S18 nonmutating rejected, resumed, and conflicting outcomes passed';
  END;

  BEGIN
    SELECT count(*) INTO v_payment_a_event_count FROM public.payment_events e WHERE e.payment_id=v_payment_a_id;
    SELECT count(*) INTO v_payment_b_event_count FROM public.payment_events e WHERE e.payment_id=v_payment_b_id;
    v_before_count := v_payment_a_event_count;
    v_after_count := v_payment_b_event_count;
    SELECT count(*) INTO v_payment_a_attempt_count FROM public.shift4_payment_attempts a WHERE a.payment_id=v_payment_a_id;
    SELECT count(*) INTO v_payment_b_attempt_count FROM public.shift4_payment_attempts a WHERE a.payment_id=v_payment_b_id;
    IF v_payment_a_attempt_count <> 0 OR v_payment_b_attempt_count <> 0 THEN
      RAISE EXCEPTION 'S19 requires pristine payment-scoped attempt counts';
    END IF;
    SELECT count(*) INTO v_payment_a_fee_count
      FROM public.ledger_transactions t JOIN public.ledger_links l ON l.ledger_transaction_id=t.id
     WHERE t.event_type='shift4.platform_fee' AND l.link_type='payment' AND l.payment_id=v_payment_a_id;
    SELECT count(*) INTO v_payment_b_fee_count
      FROM public.ledger_transactions t JOIN public.ledger_links l ON l.ledger_transaction_id=t.id
     WHERE t.event_type='shift4.platform_fee' AND l.link_type='payment' AND l.payment_id=v_payment_b_id;

    /* Establish payment B first, then prove every payment A mutation leaves its
       group, lifecycle, captured total, fee decision, and evidence counts alone. */
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s19-b1', v_merchant_id, v_payment_b_id, v_connection_id,
      'sale','ecommerce',v_invoices[20],v_total_b,upper(v_payment_b.currency),
      'idem-'||v_run||'-s19-b1','fp-'||v_run||'-s19-b1','corr-'||v_run||'-s19-b1'
    );
    IF v_create.outcome <> 'created' THEN RAISE EXCEPTION 'S19 payment B attempt creation failed: %', v_create.outcome; END IF;
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s19-b1', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'PROCESSING',
      p_response_code=>'P', p_approved_amount_minor=>v_half_b, p_authorized_amount_minor=>v_half_b
    );
    IF v_apply.outcome NOT IN ('applied','already_applied') THEN RAISE EXCEPTION 'S19 payment B partial evidence failed: %', v_apply.outcome; END IF;
    SELECT * INTO v_attempt_b FROM public.shift4_payment_attempts a WHERE a.attempt_id='smoke-'||v_run||'-s19-b1';
    SELECT * INTO v_group_b FROM public.shift4_tender_groups g WHERE g.id=v_attempt_b.tender_group_id;
    v_payment_b_group_version := v_group_b.version;
    v_before_sequence := v_group_b.next_tender_sequence;
    v_remaining_before := v_attempt_b.remaining_amount_minor;
    SELECT coalesce(sum(a.approved_amount_minor),0) INTO v_captured_before
      FROM public.shift4_payment_attempts a
     WHERE a.tender_group_id=v_group_b.id AND a.operation IN ('sale','capture') AND a.state='approved';
    v_payment_b_status := (SELECT p.status FROM public.payments p WHERE p.id=v_payment_b_id);
    SELECT count(*) INTO v_payment_b_event_count FROM public.payment_events e WHERE e.payment_id=v_payment_b_id;
    SELECT count(*) INTO v_payment_b_attempt_count FROM public.shift4_payment_attempts a WHERE a.payment_id=v_payment_b_id;
    IF v_payment_b_event_count <= v_after_count THEN RAISE EXCEPTION 'S19 payment B event count did not advance'; END IF;

    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s19-a1', v_merchant_id, v_payment_a_id, v_connection_id,
      'sale','ecommerce',v_invoices[21],v_total,upper(v_payment_a.currency),
      'idem-'||v_run||'-s19-a1','fp-'||v_run||'-s19-a1','corr-'||v_run||'-s19-a1'
    );
    IF v_create.outcome <> 'created' THEN RAISE EXCEPTION 'S19 payment A attempt creation failed: %', v_create.outcome; END IF;
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s19-a1', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'PROCESSING',
      p_response_code=>'P', p_approved_amount_minor=>v_half, p_authorized_amount_minor=>v_half
    );
    IF v_apply.outcome NOT IN ('applied','already_applied') THEN RAISE EXCEPTION 'S19 payment A partial evidence failed: %', v_apply.outcome; END IF;
    SELECT * INTO v_attempt_a FROM public.shift4_payment_attempts a WHERE a.attempt_id='smoke-'||v_run||'-s19-a1';
    SELECT * INTO v_group_a FROM public.shift4_tender_groups g WHERE g.id=v_attempt_a.tender_group_id;

    /* A second payment-A tender advances and completes only A. */
    SELECT * INTO v_create FROM public.create_shift4_payment_attempt(
      'smoke-'||v_run||'-s19-a2', v_merchant_id, v_payment_a_id, v_connection_id,
      'sale','ecommerce',v_invoices[22],v_remainder,upper(v_payment_a.currency),
      'idem-'||v_run||'-s19-a2','fp-'||v_run||'-s19-a2','corr-'||v_run||'-s19-a2'
    );
    SELECT * INTO v_attempt FROM public.shift4_payment_attempts a WHERE a.id=v_create.attempt_row_id;
    IF v_create.outcome <> 'created' OR v_attempt.tender_sequence <> 2 THEN
      RAISE EXCEPTION 'S19 payment A second tender sequence allocation failed';
    END IF;
    SELECT * INTO v_apply FROM public.apply_shift4_attempt_evidence(
      p_merchant_id=>v_merchant_id, p_attempt_id=>'smoke-'||v_run||'-s19-a2', p_expected_version=>v_create.version,
      p_state=>'approved', p_recovery_state=>'none', p_target_status=>'CONFIRMED',
      p_response_code=>'A', p_approved_amount_minor=>v_remainder, p_authorized_amount_minor=>v_remainder
    );
    IF v_apply.outcome NOT IN ('applied','already_applied') THEN RAISE EXCEPTION 'S19 payment A completion evidence failed: %', v_apply.outcome; END IF;

    SELECT * INTO v_group_a FROM public.shift4_tender_groups g WHERE g.id=v_group_a.id;
    SELECT * INTO v_group_b FROM public.shift4_tender_groups g WHERE g.id=v_group_b.id;
    SELECT coalesce(sum(a.approved_amount_minor),0) INTO v_captured_after
      FROM public.shift4_payment_attempts a
     WHERE a.tender_group_id=v_group_a.id AND a.operation IN ('sale','capture') AND a.state='approved';
    SELECT coalesce(sum(a.approved_amount_minor),0) INTO v_captured_before
      FROM public.shift4_payment_attempts a
     WHERE a.tender_group_id=v_group_b.id AND a.operation IN ('sale','capture') AND a.state='approved';
    SELECT count(*) INTO v_fee_before
      FROM public.ledger_transactions t JOIN public.ledger_links l ON l.ledger_transaction_id=t.id
     WHERE t.event_type='shift4.platform_fee' AND l.link_type='payment' AND l.payment_id=v_payment_a_id;
    SELECT count(*) INTO v_fee_after
      FROM public.ledger_transactions t JOIN public.ledger_links l ON l.ledger_transaction_id=t.id
     WHERE t.event_type='shift4.platform_fee' AND l.link_type='payment' AND l.payment_id=v_payment_b_id;

    IF v_group_a.id = v_group_b.id
       OR v_group_a.payment_id <> v_payment_a_id OR v_group_b.payment_id <> v_payment_b_id
       OR v_group_a.merchant_provider_connection_id <> v_connection_id
       OR v_group_b.merchant_provider_connection_id <> v_connection_id
       OR v_group_a.next_tender_sequence <> 3 OR v_group_b.next_tender_sequence <> v_before_sequence
       OR v_before_sequence <> 2 OR v_group_b.version <> v_payment_b_group_version
       OR v_group_a.state <> 'settled' OR v_group_b.state <> 'open'
       OR v_attempt_a.remaining_amount_minor <> v_remainder
       OR v_attempt_b.remaining_amount_minor <> v_remaining_before OR v_remaining_before <> v_remainder_b
       OR v_captured_after <> v_total OR v_captured_before <> v_half_b
       OR (SELECT p.status FROM public.payments p WHERE p.id=v_payment_a_id) <> 'CONFIRMED'
       OR (SELECT p.status FROM public.payments p WHERE p.id=v_payment_b_id) <> v_payment_b_status
       OR v_payment_b_status <> 'PROCESSING'
       OR v_fee_before <> v_payment_a_fee_count + 1 OR v_fee_after <> v_payment_b_fee_count
       OR (SELECT count(*) FROM public.shift4_tender_groups g WHERE g.payment_id=v_payment_a_id) <> 1
       OR (SELECT count(*) FROM public.shift4_tender_groups g WHERE g.payment_id=v_payment_b_id) <> 1
       OR (SELECT count(*) FROM public.shift4_payment_attempts a WHERE a.payment_id=v_payment_a_id) <> 2
       OR (SELECT count(*) FROM public.shift4_payment_attempts a WHERE a.payment_id=v_payment_b_id) <> v_payment_b_attempt_count
       OR v_payment_b_attempt_count <> 1
       OR (SELECT count(*) FROM public.payment_events e WHERE e.payment_id=v_payment_a_id) <= v_before_count
       OR (SELECT count(*) FROM public.payment_events e WHERE e.payment_id=v_payment_b_id) <> v_payment_b_event_count THEN
      RAISE EXCEPTION 'S19 payment and tender-group isolation assertion failed';
    END IF;
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='scenario rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN RAISE NOTICE 'S19 payment and tender-group isolation passed';
  END;

  /* Final containment proof. Every scenario subtransaction has rolled back, so
     only the four generated outer fixtures (plus synthetic ledger accounts)
     may remain visible until the mandatory outer ROLLBACK. */
  IF (SELECT count(*) FROM public.merchants m
       WHERE m.id=v_merchant_id AND m.email=v_smoke_email
         AND m.business_name=v_smoke_business_name) <> 1
     OR (SELECT count(*) FROM public.merchants m WHERE m.email=v_smoke_email) <> 1 THEN
    RAISE EXCEPTION 'Final containment failed: synthetic merchant identity changed or escaped its generated UUID';
  END IF;

  IF (SELECT count(*) FROM public.merchant_providers mp
       WHERE mp.id=v_connection_id AND mp.merchant_id=v_merchant_id
         AND mp.provider='shift4_rest' AND mp.status='active' AND mp.enabled=true
         AND mp.credentials->>'synthetic'='true'
         AND mp.credentials->>'rollbackOnly'='true'
         AND mp.credentials->>'smokeRun'=v_run) <> 1 THEN
    RAISE EXCEPTION 'Final containment failed: synthetic Shift4 connection identity changed';
  END IF;

  IF (SELECT count(*) FROM public.payments p
       WHERE p.id IN (v_payment_a_id,v_payment_b_id)
         AND p.merchant_id=v_merchant_id AND p.status='CREATED' AND p.currency='USD'
         AND p.provider='shift4' AND p.network='shift4'
         AND p.metadata->>'synthetic'='true'
         AND p.metadata->>'rollbackOnly'='true'
         AND p.metadata->>'smokeRun'=v_run) <> 2
     OR (SELECT count(*) FROM public.payments p WHERE p.metadata->>'smokeRun'=v_run) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.payments p
        WHERE p.id=v_payment_a_id
          AND p.subtotal_amount=200 AND p.platform_fee=15 AND p.total_amount=215
          AND p.merchant_amount=2.00
          AND p.pinetree_fee=0.15 AND p.gross_amount=2.15
          AND p.subtotal_amount=p.merchant_amount*100
          AND p.platform_fee=p.pinetree_fee*100
          AND p.total_amount=p.gross_amount*100
          AND p.subtotal_amount+p.platform_fee=p.total_amount
          AND p.merchant_amount+p.pinetree_fee=p.gross_amount
          AND (p.metadata->>'merchantAmountMinor')::bigint=200
          AND (p.metadata->>'pinetreeFeeMinor')::bigint=15
          AND (p.metadata->>'grossAmountMinor')::bigint=215
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.payments p
        WHERE p.id=v_payment_b_id
          AND p.subtotal_amount=300 AND p.platform_fee=15 AND p.total_amount=315
          AND p.merchant_amount=3.00
          AND p.pinetree_fee=0.15 AND p.gross_amount=3.15
          AND p.subtotal_amount=p.merchant_amount*100
          AND p.platform_fee=p.pinetree_fee*100
          AND p.total_amount=p.gross_amount*100
          AND p.subtotal_amount+p.platform_fee=p.total_amount
          AND p.merchant_amount+p.pinetree_fee=p.gross_amount
          AND (p.metadata->>'merchantAmountMinor')::bigint=300
          AND (p.metadata->>'pinetreeFeeMinor')::bigint=15
          AND (p.metadata->>'grossAmountMinor')::bigint=315
     ) THEN
    RAISE EXCEPTION 'Final containment failed: synthetic payment identity, money, or lifecycle changed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.shift4_payment_attempts a WHERE a.payment_id IN (v_payment_a_id,v_payment_b_id))
     OR EXISTS (SELECT 1 FROM public.shift4_tender_groups g WHERE g.payment_id IN (v_payment_a_id,v_payment_b_id))
     OR EXISTS (SELECT 1 FROM public.shift4_tokenization_sessions s WHERE s.payment_id IN (v_payment_a_id,v_payment_b_id))
     OR EXISTS (SELECT 1 FROM public.ledger_links l WHERE l.payment_id IN (v_payment_a_id,v_payment_b_id))
     OR EXISTS (SELECT 1 FROM public.payment_events e WHERE e.payment_id IN (v_payment_a_id,v_payment_b_id)) THEN
    RAISE EXCEPTION 'Final containment failed: a scenario left durable payment evidence before outer rollback';
  END IF;

  RAISE NOTICE 'Final containment assertions passed for generated rollback-only fixtures';
END
$smoke$;

/* Reaching this row proves S01-S19 and the final containment assertions passed.
   The immediately following ROLLBACK is the containment result; no same-
   transaction verification query can or should run after it. */
SELECT 'SUCCESS: all PineTree Shift4 runtime smoke assertions passed; transaction will now roll back' AS smoke_test_result;
ROLLBACK;
