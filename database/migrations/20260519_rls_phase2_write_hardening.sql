-- PineTree Payments — Phase 2 RLS Hardening: Restrict Direct Client Writes on Financial Tables
-- Run after 20260518_support_ticket_messages.sql and 20260516_rls_full_coverage.sql
--
-- Problem:
--   All eight core financial tables were protected by `for all` policies, which
--   unintentionally allow authenticated merchants to INSERT/UPDATE/DELETE their
--   own rows directly via the Supabase JS client.  The intent was read-only
--   merchant access; all financial writes must come from backend service-role code.
--
-- What this migration does:
--   1. Drops the existing `for all` policies on the eight core financial tables.
--   2. Recreates them as `for select` only — merchants can read their own rows;
--      no authenticated-user write path is granted.
--   3. Service-role code (payment engine, event processor, ledger, cash drawer)
--      bypasses RLS by design and is unaffected.
--   4. Adds three missing composite indexes for common dashboard/report queries.
--
-- Tables hardened (SELECT-only for authenticated merchants; writes reserved for service role):
--   payments, payment_events, transactions, ledger_entries, payment_intents,
--   cash_drawer_log, merchant_wallets, wallet_balances
--
-- No TypeScript files, provider logic, payment logic, or dashboard UI are modified.
-- No schema column changes; only policy and index changes.


-- ─── payments ────────────────────────────────────────────────────────────────
-- All writes (create, status updates, expiry) come from the payment engine using
-- the service role.  Merchants SELECT their own payments for the dashboard and
-- reporting queries.

drop policy if exists "Merchants see own payments"  on public.payments;
drop policy if exists "Merchants read own payments" on public.payments;

create policy "Merchants read own payments"
  on public.payments for select
  using (merchant_id::text = auth.uid()::text);


-- ─── transactions ─────────────────────────────────────────────────────────────
-- Written exclusively by the payment engine (service role) upon settlement.

drop policy if exists "Merchants see own transactions"  on public.transactions;
drop policy if exists "Merchants read own transactions" on public.transactions;

create policy "Merchants read own transactions"
  on public.transactions for select
  using (merchant_id::text = auth.uid()::text);


-- ─── payment_events ──────────────────────────────────────────────────────────
-- Written exclusively by the event processor (service role).
-- Read access is scoped through the parent payment's merchant ownership because
-- payment_events has no direct merchant_id column.

drop policy if exists "Merchants see own payment events"  on public.payment_events;
drop policy if exists "Merchants read own payment events" on public.payment_events;

create policy "Merchants read own payment events"
  on public.payment_events for select
  using (
    payment_id::text in (
      select id::text from public.payments where merchant_id::text = auth.uid()::text
    )
  );


-- ─── ledger_entries ──────────────────────────────────────────────────────────
-- Written exclusively by the ledger engine (service role).
-- merchant_id is nullable in the schema; rows without an owner are excluded.

drop policy if exists "Merchants see own ledger"  on public.ledger_entries;
drop policy if exists "Merchants read own ledger" on public.ledger_entries;

create policy "Merchants read own ledger"
  on public.ledger_entries for select
  using (merchant_id::text = auth.uid()::text);


-- ─── payment_intents ─────────────────────────────────────────────────────────
-- Written by the intent engine and payment-creation path (service role).
-- Public checkout reads flow through server API routes (supabaseAdmin), not RLS.
--
-- NOTE: payment_intents.merchant_id is type TEXT (defined in 20260410_add_payment_intents.sql).
-- The 20260418_full_schema.sql `create table if not exists` was a no-op because the
-- table already existed.  The ::text cast on auth.uid() is required and intentional.

drop policy if exists "Merchants see own intents"  on public.payment_intents;
drop policy if exists "Merchants read own intents" on public.payment_intents;

create policy "Merchants read own intents"
  on public.payment_intents for select
  using (merchant_id::text = auth.uid()::text);


-- ─── cash_drawer_log ─────────────────────────────────────────────────────────
-- Written exclusively by the cash drawer engine via server API routes (service role).
-- Merchants SELECT their own entries for shift review in the dashboard.

drop policy if exists "Merchants see own drawer"  on public.cash_drawer_log;
drop policy if exists "Merchants read own drawer" on public.cash_drawer_log;

create policy "Merchants read own drawer"
  on public.cash_drawer_log for select
  using (merchant_id::text = auth.uid()::text);


-- ─── merchant_wallets ────────────────────────────────────────────────────────
-- Wallet address management is performed through server API routes (supabaseAdmin).
-- No direct client write path is needed or granted.

drop policy if exists "Merchants see own wallets"  on public.merchant_wallets;
drop policy if exists "Merchants read own wallets" on public.merchant_wallets;

create policy "Merchants read own wallets"
  on public.merchant_wallets for select
  using (merchant_id::text = auth.uid()::text);


-- ─── wallet_balances ─────────────────────────────────────────────────────────
-- Balance upserts are performed exclusively by the payment engine (service role).
-- No direct client write path is needed or granted.

drop policy if exists "Merchants see own balances"  on public.wallet_balances;
drop policy if exists "Merchants read own balances" on public.wallet_balances;

create policy "Merchants read own balances"
  on public.wallet_balances for select
  using (merchant_id::text = auth.uid()::text);


-- ─── Composite indexes for merchant dashboard and report queries ──────────────
-- Single-column merchant_id indexes already exist on all eight tables.
-- These composite indexes cover the common ordered and filtered access patterns
-- used by the dashboard transaction list and financial report generation.

create index if not exists payments_merchant_id_created_at_idx
  on public.payments (merchant_id, created_at desc);

create index if not exists payments_merchant_id_status_idx
  on public.payments (merchant_id, status);

create index if not exists transactions_merchant_id_created_at_idx
  on public.transactions (merchant_id, created_at desc);


-- ─── Notify PostgREST to reload schema cache ─────────────────────────────────

select pg_notify('pgrst', 'reload schema');
