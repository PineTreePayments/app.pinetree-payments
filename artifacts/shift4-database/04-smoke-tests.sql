-- PineTree Shift4 transaction-contained synthetic smoke tests
-- static source validation only; PostgreSQL runtime status remains not_executed.
-- Run with psql variables merchant_id, payment_id, connection_id referencing disposable synthetic parent rows.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF current_setting('transaction_read_only')::boolean THEN RAISE EXCEPTION 'Writable disposable transaction required'; END IF;
  IF to_regclass('public.ledger_transactions') IS NULL OR to_regclass('public.shift4_payment_attempts') IS NULL THEN RAISE EXCEPTION 'Release objects missing'; END IF;
END;
$$;
-- S01 balanced journal: call post_ledger_transaction with equal integer debit/credit lines; assert one transaction and balanced entries.
-- S02 unbalanced rejection: repeat with unequal totals inside an exception-catching DO block.
-- S03 duplicate posting: repeat S01 with identical posting key and payload; assert same transaction identity.
-- S04 conflicting posting key: repeat posting key with changed integer amount; assert rejection.
-- S05 account mismatch: use an account owned by another synthetic merchant; assert rejection.
-- S06 invalid lifecycle link: link a capture to a non-authorization parent; assert rejection.
-- S07 cross-tenant attempt: call create_shift4_payment_attempt with mismatched merchant/payment; assert rejection.
-- S08 attempt creation: create one synthetic authorization attempt and assert merchant/payment/invoice ownership.
-- S09 partial approval: apply evidence with an approved amount below requested amount; assert remaining amount and PROCESSING.
-- S10 first capture: create/capture first tender and assert canonical payment remains PROCESSING.
-- S11 second capture: create/capture remaining tender and assert total exactly equals payment amount.
-- S12 fee once: assert one fee journal posting across both tenders.
-- S13 exact confirmation: assert payment becomes CONFIRMED only when captured total equals required total.
-- S14 tokenization: create synthetic opaque fingerprint, consume once, then assert replay rejection without storing raw token.
-- S15 onboarding: create synthetic session, apply one update, replay update_reference, and assert one append-only event.
-- S16 append-only: attempt UPDATE/DELETE of journal and onboarding evidence and assert trigger rejection.
-- Operator assertion queries (must all return zero rows):
SELECT ledger_transaction_id FROM public.ledger_journal_entries GROUP BY ledger_transaction_id HAVING sum(CASE WHEN side='debit' THEN amount_minor ELSE -amount_minor END) <> 0;
SELECT l.payment_id FROM public.ledger_transactions t JOIN public.ledger_links l ON l.ledger_transaction_id=t.id WHERE t.event_type='shift4.platform_fee' AND l.link_type='payment' GROUP BY l.payment_id HAVING count(*) > 1;
SELECT session_id FROM public.shift4_tokenization_sessions WHERE token_fingerprint IS NOT NULL AND token_fingerprint !~ '^[0-9a-f]{24}
ROLLBACK;
;
ROLLBACK;
