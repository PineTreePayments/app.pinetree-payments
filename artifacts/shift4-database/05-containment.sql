-- PineTree Shift4 containment; preserves financial and certification evidence.
-- 1. Set every SHIFT4_* enablement flag false through controlled deployment configuration.
-- 2. Stop new Shift4 checkout, POS, onboarding, and certification-fixture traffic.
-- 3. Keep read-only invoice lookup/reconciliation available only under incident approval.
-- 4. Do not DROP, TRUNCATE, DELETE, or rewrite attempts, tenders, journal, tokenization, onboarding, or evidence.
-- 5. Verify production_processing readiness is blocked before resuming general traffic.
SELECT state, recovery_state, count(*) FROM public.shift4_payment_attempts GROUP BY state, recovery_state ORDER BY state, recovery_state;
SELECT status, count(*) FROM public.shift4_onboarding_sessions GROUP BY status ORDER BY status;
